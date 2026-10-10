import { committedEvents } from '../support/events.ts';
import { describe, expect, it } from 'vitest';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const source = '---\nname: reviewer\ndescription: Review changes\nfuture: { retain: true }\n---\n\nReview $ARGUMENTS without modifying files.\n';
const group = { matcher: 'Bash', hooks: [{ type: 'command', command: `node -e "require('node:fs').writeFileSync('hook-executed', 'yes')"` }] };
async function workspace(name: string) {
  const root = join(fixture.project, name);
  await mkdir(root);
  return { root, cli: (args: string[], input?: string | Buffer) => fixture.cli(['claude', ...args], input, { root }) };
}

describe('portable native Claude management', () => {
  it('manages selected-project agents without redirecting workspace or sibling files', async () => {
    const { root, cli } = await workspace('agent-context');
    for (const name of ['alpha', 'beta']) expect(fixture.cli(['project', 'create', name], undefined, { root }).status).toBe(0);
    expect(fixture.cli(['project', 'open', 'alpha'], undefined, { root }).status).toBe(0);
    const selected = join(root, 'projects/alpha');
    const preview = cli(['agents', 'create', 'reviews/security', '--stdin', '--dry-run'], source);
    expect(preview.status).toBe(0);
    expect(preview.body.data).toMatchObject({ dryRun: true, target: { scope: 'project', directory: join(selected, '.claude') } });
    expect(committedEvents(preview.body.events)).toEqual([]);
    await expect(readFile(join(selected, '.claude/agents/reviews/security.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    const created = cli(['agents', 'create', 'reviews/security', '--stdin'], source);
    expect(created.status).toBe(0);
    expect(created.body.context.root).toBe(selected);
    expect(committedEvents(created.body.events).map((event: { id: string }) => event.id)).toEqual(['file.created']);
    expect(await readFile(join(selected, '.claude/agents/reviews/security.md'), 'utf8')).toBe(source);
    for (const directory of [root, join(root, 'projects/beta')]) await expect(readFile(join(directory, '.claude/agents/reviews/security.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    const before = cli(['agents', 'inspect', 'reviews/security']).body.data;
    expect(before.metadata).toMatchObject({ name: 'reviewer', future: { retain: true } });
    expect(cli(['agents', 'list']).body.data.agents).toMatchObject([{ id: 'reviews/security', name: 'reviewer', valid: true }]);
    const next = source.replace('Review changes', 'Review security changes');
    expect(cli(['agents', 'update', 'reviews/security', '--if-match', before.revision, '--stdin'], next).status).toBe(0);
    expect(cli(['agents', 'remove', 'reviews/security', '--if-match', before.revision]).body.error.code).toBe('CONFLICT');
    const current = cli(['agents', 'inspect', 'reviews/security']).body.data;
    expect(cli(['agents', 'export', 'reviews/security']).body.data.session.reviewer.prompt).toContain('$ARGUMENTS');
    expect(committedEvents(cli(['agents', 'remove', 'reviews/security', '--if-match', current.revision, '--dry-run']).body.events)).toEqual([]);
    expect(await readFile(join(selected, current.path), 'utf8')).toBe(next);
    expect(committedEvents(cli(['agents', 'remove', 'reviews/security', '--if-match', current.revision]).body.events)[0]?.id).toBe('file.deleted');
    await expect(readFile(join(selected, current.path))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  it('edits native hooks and agent permissions through settings revision guards', async () => {
    const { root, cli } = await workspace('settings');
    await mkdir(join(root, '.claude'));
    await writeFile(join(root, '.claude/settings.json'), JSON.stringify({ model: 'sonnet', permissions: { deny: ['Bash(rm *)', 'Agent(other)'] }, future: { keep: true } }));
    let settings = cli(['hooks', 'inspect']).body.data;
    expect(cli(['hooks', 'set', '--content', '{}']).body.error.code).toBe('CONFLICT');
    expect(cli(['hooks', 'add', 'PreToolUse', '--if-match', settings.revision, '--stdin'], JSON.stringify(group)).status).toBe(0);
    settings = cli(['hooks', 'inspect']).body.data;
    expect(settings.settings).toMatchObject({ model: 'sonnet', hooks: { PreToolUse: [group] }, future: { keep: true } });
    expect(cli(['hooks', 'configure', '--if-match', settings.revision, '--stdin'], JSON.stringify({ allowedHttpHookUrls: ['https://hooks.example/*'], httpHookAllowedEnvVars: ['TOKEN'] })).status).toBe(0);
    settings = cli(['hooks', 'inspect']).body.data;
    expect(cli(['hooks', 'disable', '--if-match', settings.revision]).status).toBe(0);
    expect(cli(['hooks', 'check']).body.data.settings.disableAllHooks).toBe(true);
    expect(cli(['agents', 'create', 'review', '--stdin'], source).status).toBe(0);
    settings = cli(['hooks', 'inspect']).body.data;
    expect(cli(['agents', 'disable', 'review', '--if-match', settings.revision]).status).toBe(0);
    settings = cli(['hooks', 'inspect']).body.data;
    expect(settings.settings.permissions.deny).toEqual(['Bash(rm *)', 'Agent(other)', 'Agent(reviewer)']);
    expect(cli(['agents', 'enable', 'review', '--if-match', settings.revision]).status).toBe(0);
    settings = cli(['hooks', 'inspect']).body.data;
    expect(settings.settings.permissions.deny).toEqual(['Bash(rm *)', 'Agent(other)']);
    expect(cli(['hooks', 'remove', 'PreToolUse', '--index', '0', '--if-match', settings.revision]).status).toBe(0);
    expect(cli(['hooks', 'inspect']).body.data.settings).toMatchObject({ hooks: {}, disableAllHooks: true, future: { keep: true } });
    await expect(readFile(join(root, 'hook-executed'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  it('exports native agents into visible selected-project files with dry runs and destination revision guards', async () => {
    const { root, cli } = await workspace('agent-export');
    expect(fixture.cli(['project', 'create', 'alpha'], undefined, { root }).status).toBe(0);
    expect(fixture.cli(['project', 'open', 'alpha'], undefined, { root }).status).toBe(0);
    const selected = join(root, 'projects/alpha');
    const directory = join(fixture.project, 'export-user-config');
    const scope = ['--scope', 'user', '--claude-dir', directory];
    expect(cli(['agents', 'create', 'review', ...scope, '--stdin'], source).status).toBe(0);
    const out = 'visible/agents/reviewer.md';
    const args = ['agents', 'export', 'review', ...scope, '--out', out];
    const preview = cli([...args, '--dry-run']);
    expect(preview.status).toBe(0);
    expect(preview.body.data).toMatchObject({ dryRun: true, outputRoot: selected, preview: [{ path: out, content: expect.stringContaining('name: reviewer') }] });
    expect(committedEvents(preview.body.events)).toEqual([]);
    await expect(readFile(join(selected, out))).rejects.toMatchObject({ code: 'ENOENT' });
    const exported = cli(args);
    expect(exported.status).toBe(0);
    expect(exported.body.data).toMatchObject({ outputRoot: selected, changes: [{ path: out, operation: 'created' }] });
    expect(exported.body.context.root).toBe(selected);
    expect(await readFile(join(selected, out), 'utf8')).toBe(exported.body.data.content);
    expect(await readFile(join(directory, 'agents/review.md'), 'utf8')).toBe(source);
    await expect(readFile(join(root, out))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(directory, out))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(join(selected, 'agents.base'), JSON.stringify({ filters: 'name == "reviewer"', views: [{ type: 'table', name: 'Agents' }] }));
    const repository = fixture.cli(['bases', 'query', 'agents.base'], undefined, { root });
    expect(repository.status).toBe(0);
    expect(repository.body.data.files).toEqual([out]);
    const importedRevision = cli(['agents', 'inspect', 'review', ...scope]).body.data.revision;
    await writeFile(join(selected, out), exported.body.data.content.replace('Review changes', 'Review vault changes'));
    expect(cli(['agents', 'update', 'review', ...scope, '--from', out, '--if-match', importedRevision]).status).toBe(0);
    expect(await readFile(join(directory, 'agents/review.md'), 'utf8')).toContain('Review vault changes');
    await writeFile(join(selected, out), exported.body.data.content);
    expect(cli(args).body.error.code).toBe('CONFLICT');
    const destinationRevision = exported.body.data.changes[0].revision;
    const agentRevision = cli(['agents', 'inspect', 'review', ...scope]).body.data.revision;
    const updated = source.replace('Review changes', 'Review release changes');
    expect(cli(['agents', 'update', 'review', ...scope, '--if-match', agentRevision, '--stdin'], updated).status).toBe(0);
    const replacementPreview = cli([...args, '--if-match', destinationRevision, '--dry-run']);
    expect(replacementPreview.status).toBe(0);
    expect(replacementPreview.body.data.preview[0].content).toContain('Review release changes');
    expect(await readFile(join(selected, out), 'utf8')).toBe(exported.body.data.content);
    expect(committedEvents(replacementPreview.body.events)).toEqual([]);
    const replaced = cli([...args, '--if-match', destinationRevision]);
    expect(replaced.status).toBe(0);
    expect(replaced.body.data.changes[0]).toMatchObject({ path: out, operation: 'updated' });
    expect(await readFile(join(selected, out), 'utf8')).toBe(replaced.body.data.content);
    expect(cli([...args, '--if-match', destinationRevision]).body.error.code).toBe('CONFLICT');
    expect(cli(['agents', 'export', 'review', ...scope, '--if-match', agentRevision]).body.error.code).toBe('INVALID_ARGUMENT');
    expect(cli(['agents', 'export', 'review', ...scope, '--out', '../escape.md']).body.error.code).toBe('INVALID_PATH');
    expect(cli(['agents', 'export', 'review', ...scope, '--out', 'agent.json']).body.error.code).toBe('INVALID_ARGUMENT');
  }, 60_000);

  it('creates native plugin assets and round-trips binary files without executing plugin code', async () => {
    const { root, cli } = await workspace('plugin-assets');
    const manifest = { name: 'team-tools', description: 'Team helpers', version: '1.0.0', future: { retain: true } };
    expect(committedEvents(cli(['plugins', 'create', 'plugins/team', '--stdin', '--dry-run'], JSON.stringify(manifest)).body.events)).toEqual([]);
    await expect(readFile(join(root, 'plugins/team/.claude-plugin/plugin.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(cli(['plugins', 'create', 'plugins/team', '--stdin'], JSON.stringify(manifest)).status).toBe(0);
    expect(cli(['agents', 'create', 'review', '--scope', 'plugin', '--directory', 'plugins/team', '--stdin'], source).status).toBe(0);
    expect(cli(['hooks', 'set', '--scope', 'plugin', '--directory', 'plugins/team', '--stdin'], JSON.stringify({ PreToolUse: [group] })).status).toBe(0);
    const bytes = Buffer.from([0, 255, 1, 128, 13, 10]);
    expect(cli(['plugins', 'write-asset', 'plugins/team', 'assets/raw.bin', '--stdin'], bytes).status).toBe(0);
    expect(await readFile(join(root, 'plugins/team/assets/raw.bin'))).toEqual(bytes);
    const asset = cli(['plugins', 'asset', 'plugins/team', 'assets/raw.bin']).body.data;
    expect(asset.bytes).toBe(bytes.length);
    expect(cli(['plugins', 'check', 'plugins/team']).body.data).toMatchObject({ valid: true, validation: 'structure' });
    const inspected = cli(['plugins', 'inspect', 'plugins/team']).body.data;
    expect(inspected.manifest).toEqual(manifest);
    expect(inspected.files).toContain('agents/review.md');
    expect(cli(['plugins', 'remove-asset', 'plugins/team', 'assets/raw.bin', '--if-match', 'stale']).body.error.code).toBe('CONFLICT');
    expect(cli(['plugins', 'remove-asset', 'plugins/team', 'assets/raw.bin', '--if-match', asset.revision]).status).toBe(0);
    await expect(readFile(join(root, 'plugins/team/assets/raw.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(cli(['plugins', 'write-asset', 'plugins/team', '../outside', '--content', 'bad']).body.error.code).toBe('INVALID_PATH');
  }, 60_000);

  it('keeps explicit user overrides isolated and dry runs leave missing user directories absent', async () => {
    const { root, cli } = await workspace('user-scope');
    const directory = join(fixture.project, 'isolated-user-config/deep');
    const flags = ['--scope', 'user', '--claude-dir', directory];
    const preview = cli(['agents', 'create', 'review', ...flags, '--stdin', '--dry-run'], source);
    expect(preview.status).toBe(0);
    expect(preview.body.data.target).toMatchObject({ scope: 'user', directory });
    expect(preview.body.context.root).toBe(root);
    expect(committedEvents(preview.body.events)).toEqual([]);
    await expect(readdir(join(fixture.project, 'isolated-user-config'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(cli(['agents', 'create', 'review', ...flags, '--stdin'], source).status).toBe(0);
    expect(await readFile(join(directory, 'agents/review.md'), 'utf8')).toBe(source);
    await expect(readFile(join(root, '.claude/agents/review.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(cli(['agents', 'list']).body.data.agents).toEqual([]);
    expect(cli(['agents', 'list', ...flags]).body.data.agents).toHaveLength(1);
    expect(cli(['agents', 'list', '--scope', 'local']).body.error.code).toBe('INVALID_ARGUMENT');
  }, 60_000);

  it.skipIf(process.platform === 'win32')('previews installed lifecycle without spawning and executes only the explicitly selected fixture', async () => {
    const { root, cli } = await workspace('runtime-fixture');
    const executable = join(root, 'fake-claude.mjs');
    await writeFile(executable, `#!${process.execPath}
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync('spawned.json', JSON.stringify({ args, cwd: process.cwd() }));
if (args.includes('--values-stdin')) {
  const chunks = [];
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', () => {
    writeFileSync('received-config.json', Buffer.concat(chunks));
    console.log(JSON.stringify({ args }));
  });
} else if (args.includes('list')) console.log(JSON.stringify({ args }, null, 2));
else {
  console.log('Native diagnostic');
  console.log(JSON.stringify({ args }));
  if (args.includes('broken')) { process.stderr.write('Native operation failed after starting'); process.exitCode = 2; }
}
`);
    await chmod(executable, 0o755);
    const preview = cli(['plugins', 'install', 'formatter@team', '--claude-bin', executable, '--dry-run']);
    expect(preview.status).toBe(0);
    expect(preview.body.data).toEqual({ dryRun: true, executed: false, plan: { executable, args: ['plugin', 'install', 'formatter@team', '--scope', 'project', '--json'], cwd: root } });
    await expect(readFile(join(root, 'spawned.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const result = cli(['plugins', 'list', '--claude-bin', executable]);
    expect(result.status).toBe(0);
    expect(result.body.data).toMatchObject({ executed: true, exitCode: 0, result: { args: ['plugin', 'list', '--json'] } });
    expect(JSON.parse(await readFile(join(root, 'spawned.json'), 'utf8'))).toEqual({ args: ['plugin', 'list', '--json'], cwd: root });
    const values = { token: 'private-fixture-value' };
    const configure = ['plugins', 'configure', 'formatter@team', '--values-stdin', '--stdin', '--claude-bin', executable];
    const configPreview = cli([...configure, '--dry-run'], JSON.stringify(values));
    expect(configPreview.status).toBe(0);
    expect(configPreview.body.data.plan.inputBytes).toBe(Buffer.byteLength(JSON.stringify(values) + '\n'));
    expect(configPreview.stdout).not.toContain(values.token);
    await expect(readFile(join(root, 'received-config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const configured = cli(configure, JSON.stringify(values));
    expect(configured.status).toBe(0);
    expect(configured.body.data.result.args).toContain('--values-stdin');
    expect(configured.stdout).not.toContain(values.token);
    expect(JSON.parse(await readFile(join(root, 'received-config.json'), 'utf8'))).toEqual(values);
    expect(cli(configure, JSON.stringify({ token: 'two\nlines' })).body.error.code).toBe('INVALID_INPUT');
    const failed = cli(['plugins', 'install', 'broken', '--claude-bin', executable]);
    expect(failed.status).not.toBe(0);
    expect(failed.body.error).toMatchObject({ code: 'CLAUDE_RUNTIME_FAILED', details: { exitCode: 2, stderr: 'Native operation failed after starting', stdout: expect.stringContaining('Native diagnostic') } });
    expect(cli(['runtime', 'version', '--claude-bin', join(root, 'missing'), '--dry-run']).status).toBe(0);
    expect(cli(['runtime', 'version', '--claude-bin', join(root, 'missing')]).body.error.code).toBe('CLAUDE_NOT_INSTALLED');
    expect(cli(['marketplaces', 'remove', 'team', '--dry-run']).body.data.plan.args).toEqual(['plugin', 'marketplace', 'remove', 'team', '--scope', 'project']);
  }, 60_000);
});
