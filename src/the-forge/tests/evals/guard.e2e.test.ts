import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadTasks } from '../../scripts/eval/tasks.mjs';
import { createWorkspace, hostPlugins, type EvalWorkspace } from '../../scripts/eval/workspace.mjs';
import { installGuard } from '../../scripts/eval/guard.mjs';
import { distribution } from '../support/workspace.ts';

let workspace: EvalWorkspace;
let guard: Awaited<ReturnType<typeof installGuard>>;

beforeAll(async () => {
  workspace = await createWorkspace(loadTasks().find(task => task.id === 'read-property')!, { distribution });
  guard = await installGuard(workspace.root);
}, 120_000);
afterAll(async () => {
  await guard?.dispose();
  await workspace?.dispose();
});

/** Runs the wrapper as the agent would: `node <guard>/forge.mjs ...` from the workspace root. */
function wrapper(args: string[]) {
  const result = spawnSync(process.execPath, [guard.entry, '--json', ...args], { cwd: workspace.root, encoding: 'utf8', timeout: 30_000 });
  return { status: result.status, body: JSON.parse(result.stdout) };
}

describe('the claude driver Forge wrapper', () => {
  it('lives outside the workspace, is the only allowed shell command, and runs Forge pinned to the workspace', () => {
    expect(guard.entry.startsWith(workspace.root)).toBe(false);
    expect(guard.allowedTool).toBe(`Bash(node ${guard.entry}:*)`);
    const read = wrapper(['read', 'Projects/Alpha.md']);
    expect(read.status).toBe(0);
    expect(read.body).toMatchObject({ ok: true, context: { workspaceRoot: workspace.root } });
  });

  it('disables the plugins that reach the host and refuses options that leave the workspace', async () => {
    const commands = wrapper(['schema']).body.data.commands.map((command: { id: string }) => command.id);
    expect(commands).not.toContain('claude');
    expect(commands).not.toContain('connectors');
    expect(JSON.parse(await readFile(join(workspace.root, 'bin/config.json'), 'utf8')).plugins.disabled).toEqual(hostPlugins);
    for (const args of [['--root', '/', 'list'], ['claude', 'hooks', 'add', 'Stop', '--scope', 'user', '--content', '{}']]) {
      const refused = wrapper(args);
      expect(refused.status).toBe(2);
      expect(refused.body).toMatchObject({ ok: false, error: { code: 'EVAL_REFUSED' } });
    }
  });

  it('stops running once the distribution in bin/ changes, so the agent cannot enable plugins or replace Forge', async () => {
    const config = join(workspace.root, 'bin/config.json');
    const written = wrapper(['write', 'bin/config.json', '--content', '{"schemaVersion":1}', '--if-match', wrapper(['read', 'bin/config.json']).body.data.revision]);
    expect(written.body.ok).toBe(true);
    const after = wrapper(['read', 'Home.md']);
    expect(after.status).toBe(2);
    expect(after.body.error).toMatchObject({ code: 'EVAL_REFUSED', message: expect.stringContaining('bin/ was modified') });
    await writeFile(config, '{}');
    expect(wrapper(['list']).body.error.code).toBe('EVAL_REFUSED');
  });
});
