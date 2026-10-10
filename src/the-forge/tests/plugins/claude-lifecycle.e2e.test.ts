import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const commandHash = 'a'.repeat(64);

async function configuredPlugin(name: string) {
  const root = join(fixture.project, name);
  const directory = join(root, 'bin/plugins/native-audit');
  const executableScript = join(root, 'fake-claude.mjs');
  const log = join(root, 'native-launches.jsonl');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ id: 'native-audit', name: 'Native audit', version: '1.0.0', minAppVersion: '0.1.0', description: 'Exercise the injected Claude client', author: 'Tests' }));
  await writeFile(join(root, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['native-audit'] } }));
  // The plugin has no process or filesystem imports: execution comes exclusively
  // from its public, invocation-scoped Claude lifecycle client.
  await writeFile(join(directory, 'main.mjs'), `export default {
    onload(context) { context.events.warn('native-audit activated'); },
    commands: [{
      id: 'native-audit.run', description: 'Run a native fixture', usage: 'native-audit.run [--mode success|failure]',
      options: { mode: 'string', config: 'string', secret: 'string', 'read-input': 'boolean', output: 'string' },
      async run(_args, flags, context) {
        const args = [${JSON.stringify(executableScript)}, flags.mode ?? 'success'];
        if (flags.config !== undefined) args.push('--config', flags.config);
        const sensitiveArgs = [];
        if (flags.secret !== undefined) { args.push('--credential', flags.secret); sensitiveArgs.push(args.length - 1); }
        const stdin = flags['read-input'] ? new TextDecoder().decode(await context.input()) : undefined;
        return context.claude.execute({ args, executable: ${JSON.stringify(process.execPath)},
          output: flags.output ?? 'json-last-line', stdin, sensitiveArgs });
      }
    }]
  };`);
  await writeFile(executableScript, `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString('utf8');
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, stdin, cwd: process.cwd() }) + '\\n');
if (args[0] === 'failure') {
  console.log('Native acceptance required');
  console.log(JSON.stringify({ outcome: 'failed', shownCommand: { sha256: ${JSON.stringify(commandHash)} } }));
  process.stderr.write('Operation stopped before acceptance');
  process.exitCode = 2;
} else {
  if (args[0] === 'diagnostic') console.log('Native diagnostic');
  console.log(JSON.stringify({ outcome: 'complete', cwd: process.cwd(), receivedInputBytes: Buffer.byteLength(stdin) }));
}
`);
  return {
    root, directory, log, executableScript,
    cli: (args: string[], input?: string) => fixture.cli(args, input, { root }),
    launches: async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)),
  };
}

describe('portable plugin Claude lifecycle boundary', () => {
  it('discovers configured commands without activation or a native launch', async () => {
    const plugin = await configuredPlugin('lifecycle-discovery');
    const schema = plugin.cli(['schema']);
    expect(schema.status).toBe(0);
    expect(schema.body.data.commands.map((command: { id: string }) => command.id)).toContain('native-audit.run');
    for (const result of [schema, plugin.cli(['help', 'native-audit.run']), plugin.cli(['native-audit.run', '--help']), plugin.cli(['claude', 'capabilities'])]) {
      expect(result.status).toBe(0);
      expect(result.body.warnings).toEqual([]);
      expect(result.body.events.filter((event: { id: string }) => ['plugin.activating', 'plugin.activated', 'claude.started', 'claude.executed'].includes(event.id))).toEqual([]);
    }
    await expect(readFile(plugin.log)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('previews through the injected client without launching or exposing input and argument secrets', async () => {
    const plugin = await configuredPlugin('lifecycle-preview');
    const input = JSON.stringify({ token: 'private-stdin-é' }) + '\n';
    const result = plugin.cli(['--events', 'all', 'native-audit.run', '--dry-run', '--read-input', '--config', 'token=private-config', '--secret', 'private-argument'], input);
    expect(result.status).toBe(0);
    expect(result.body.data).toMatchObject({ dryRun: true, executed: false, plan: {
      executable: process.execPath, cwd: plugin.root, inputBytes: Buffer.byteLength(input),
    } });
    expect(result.body.data.plan.args.slice(0, 3)).toEqual([plugin.executableScript, 'success', '--config']);
    for (const secret of ['private-stdin', 'private-config', 'private-argument']) expect(result.stdout).not.toContain(secret);
    expect(result.body.warnings).toContain('native-audit activated');
    expect(result.body.events.filter((event: { id: string }) => event.id === 'claude.executed')).toEqual([]);
    expect(result.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'claude.started', payload: expect.objectContaining({ dryRun: true }) }),
      expect.objectContaining({ id: 'claude.succeeded', payload: expect.objectContaining({ dryRun: true }) }),
    ]));
    await expect(readFile(plugin.log)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('runs within the selected project and retains successful structured output', async () => {
    const plugin = await configuredPlugin('lifecycle-scope');
    expect(plugin.cli(['project', 'create', 'alpha']).status).toBe(0);
    expect(plugin.cli(['project', 'create', 'beta']).status).toBe(0);
    expect(plugin.cli(['project', 'open', 'alpha']).status).toBe(0);
    const selected = join(plugin.root, 'projects/alpha');
    const result = plugin.cli(['--events', 'all', 'native-audit.run', '--mode', 'diagnostic']);
    expect(result.status).toBe(0);
    expect(result.body.context).toMatchObject({ workspaceRoot: plugin.root, root: selected });
    expect(result.body.data).toMatchObject({ dryRun: false, executed: true, cwd: selected, exitCode: 0,
      stdout: expect.stringContaining('Native diagnostic'), result: { outcome: 'complete', cwd: selected } });
    expect(result.body.events.filter((event: { id: string }) => event.id === 'claude.executed')).toEqual([{ id: 'claude.executed', payload: { executable: process.execPath, cwd: selected, exitCode: 0 } }]);
    expect(await plugin.launches()).toEqual([{ args: ['diagnostic'], stdin: '', cwd: selected }]);
  }, 60_000);

  it('passes private values intact to the native process while keeping its returned plan private', async () => {
    const plugin = await configuredPlugin('lifecycle-input');
    const input = 'private-piped-input\n';
    const result = plugin.cli(['native-audit.run', '--output', 'json', '--read-input', '--config', 'token=private-config', '--secret', 'private-argument'], input);
    expect(result.status).toBe(0);
    expect(result.body.data).toMatchObject({ executed: true, exitCode: 0, result: { outcome: 'complete', receivedInputBytes: Buffer.byteLength(input) } });
    expect(await plugin.launches()).toEqual([{ args: ['success', '--config', 'token=private-config', '--credential', 'private-argument'], stdin: input, cwd: plugin.root }]);
    for (const secret of ['private-piped-input', 'private-config', 'private-argument']) expect(result.stdout).not.toContain(secret);
  });

  it('preserves a failed native structured outcome and acceptance hash for recovery', async () => {
    const plugin = await configuredPlugin('lifecycle-failure');
    const result = plugin.cli(['--events', 'all', 'native-audit.run', '--mode', 'failure']);
    expect(result.status).not.toBe(0);
    expect(result.body.ok).toBe(false);
    expect(result.body.error).toMatchObject({ code: 'CLAUDE_RUNTIME_FAILED', details: {
      cwd: plugin.root, exitCode: 2, stderr: 'Operation stopped before acceptance',
      stdout: expect.stringContaining('Native acceptance required'),
      result: { outcome: 'failed', shownCommand: { sha256: commandHash } },
    } });
    expect(result.body.events.filter((event: { id: string }) => event.id === 'claude.executed')).toEqual([{ id: 'claude.executed', payload: { executable: process.execPath, cwd: plugin.root, exitCode: 2 } }]);
    expect(await plugin.launches()).toHaveLength(1);
  });

  it('keeps --no-plugins recovery available when a configured plugin cannot load', async () => {
    const plugin = await configuredPlugin('lifecycle-recovery');
    await writeFile(join(plugin.directory, 'main.mjs'), 'throw new Error("Plugin fixture cannot load");');
    expect(plugin.cli(['schema']).status).not.toBe(0);
    const schema = plugin.cli(['--no-plugins', 'schema']);
    expect(schema.status).toBe(0);
    expect(schema.body.data.commands.map((command: { id: string }) => command.id)).not.toContain('native-audit.run');
    const preview = plugin.cli(['--no-plugins', 'claude', 'runtime', 'version', '--claude-bin', process.execPath, '--dry-run']);
    expect(preview.status).toBe(0);
    expect(preview.body.data).toMatchObject({ dryRun: true, executed: false });
    expect(preview.body.warnings).toEqual([]);
    await expect(readFile(plugin.log)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
