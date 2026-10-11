import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTasks } from '../../scripts/eval/tasks.mjs';
import { runClaude } from '../../scripts/eval/claude.mjs';
import { installGuard } from '../../scripts/eval/guard.mjs';
import { distribution } from '../support/workspace.ts';
import { fakeClaudeSource } from './fake-claude.ts';

/**
 * The claude driver against a fake `claude` executable (fake-claude.ts): no model runs. The fake is
 * started through its shebang and the timeout case relies on POSIX process groups, so the suite skips Windows,
 * where neither exists; there the driver ends the tree with taskkill /T.
 */
const task = loadTasks().find(candidate => candidate.id === 'read-property')!;
let folder: string, claude: string;

beforeAll(async () => {
  folder = await realpath(await mkdtemp(join(tmpdir(), 'forge-fake-claude-')));
  claude = join(folder, 'claude');
  await writeFile(claude, fakeClaudeSource);
  await chmod(claude, 0o755);
});
afterAll(async () => { await rm(folder, { recursive: true, force: true }); });

/** One attempt with the fake in `mode`; returns the result and what the fake recorded. */
async function attempt(mode: string, timeoutMs = 60_000) {
  const log = join(folder, `${mode}.json`), pids = join(folder, `${mode}.pids`);
  Object.assign(process.env, { FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_PIDS: pids });
  try {
    const result = await runClaude(task, { maxTurns: 5, timeoutMs, allowedTools: ['Read'], executable: claude, distribution }, 1);
    return { result, log, pids };
  } finally { for (const key of ['FAKE_CLAUDE_MODE', 'FAKE_CLAUDE_LOG', 'FAKE_CLAUDE_PIDS']) delete process.env[key]; }
}
/** Whether `pid` still runs; a zombie that only awaits reaping by its new parent has ended. */
async function alive(pid: number) {
  try { process.kill(pid, 0); } catch { return false; }
  return !(await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')).match(/^\d+ \(.*\) Z/);
}

describe.skipIf(process.platform === 'win32')('the claude driver with a fake claude executable', () => {
  it('passes a correct attempt and starts claude without MCP servers beyond its own empty configuration', async () => {
    const { result, log } = await attempt('pass');
    expect(result).toMatchObject({ passed: true, transcript: { init: { mcpServers: [], plugins: [] }, toolCalls: { forge: 1 } } });
    const { argv } = JSON.parse(await readFile(log, 'utf8')) as { argv: string[] };
    expect(argv).toEqual(expect.arrayContaining(['--strict-mcp-config', '--setting-sources', 'project', '--permission-mode', 'dontAsk']));
    expect(argv[argv.indexOf('--mcp-config') + 1]).toBe('{"mcpServers":{}}');
  }, 120_000);

  it('fails an attempt whose session reports an MCP server', async () => {
    const { result } = await attempt('mcp');
    expect(result).toMatchObject({ passed: false, error: expect.stringContaining('MCP server github') });
  }, 120_000);

  it('refuses options that leave the workspace and stops once the distribution changes', async () => {
    const { log } = await attempt('probe');
    const { calls } = JSON.parse(await readFile(log, 'utf8')) as { calls: Array<{ args: string[]; status: number; code?: string }> };
    expect(calls.map(call => [call.args[0], call.status, call.code ?? null])).toEqual([
      ['read', 0, null], ['--root', 2, 'EVAL_REFUSED'], ['read', 0, null], ['write', 0, null], ['read', 2, 'EVAL_REFUSED'],
    ]);
  }, 120_000);

  it('ends the whole process group at the timeout and records a timeout', async () => {
    const { result, pids } = await attempt('hang', 3000);
    expect(result).toMatchObject({ passed: false, timedOut: true, error: expect.stringContaining('timed out after 3 s') });
    const started = JSON.parse(await readFile(pids, 'utf8')) as number[];
    expect(started).toHaveLength(2);
    // Termination signals are delivered asynchronously; give the killed group a moment to exit.
    for (const pid of started) await vi.waitFor(async () => expect(await alive(pid), `process ${pid}`).toBe(false), { timeout: 5000, interval: 100 });
  }, 120_000);

  it('exits 1 from npm run eval when an attempt fails', async () => {
    const results = join(folder, 'results');
    const env: NodeJS.ProcessEnv = { ...process.env, FAKE_CLAUDE_MODE: 'wrong' };
    delete env.CI;
    const run = spawnSync(process.execPath, ['scripts/eval/run.mjs', '--driver', 'claude', '--task', task.id, '--claude', claude, '--results', results], { encoding: 'utf8', env, timeout: 120_000 });
    expect(run.status, run.stderr).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ passRate: 0, timedOut: 0 });
    expect(await readdir(results)).toHaveLength(1);
  }, 150_000);
});

describe('the guarded Forge environment', () => {
  it('passes Forge only the forwarded variables and a home inside the guard folder', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'forge-env-probe-')));
    try {
      await mkdir(join(root, 'bin'));
      await writeFile(join(root, 'bin/forge.js'), 'process.stdout.write(JSON.stringify(process.env));\n');
      const guard = await installGuard(root);
      try {
        const env = { ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}), PATH: process.env.PATH, LANG: 'de_DE.UTF-8', ANTHROPIC_API_KEY: 'sk-probe-key', AZURE_DEVOPS_EXT_PAT: 'probe-pat', NODE_OPTIONS: '--max-old-space-size=512' };
        const run = spawnSync(process.execPath, [guard.entry, 'list'], { encoding: 'utf8', env });
        expect(run.stderr).toBe('');
        const seen = JSON.parse(run.stdout) as Record<string, string>;
        expect(seen).toMatchObject({ PATH: process.env.PATH, LANG: 'de_DE.UTF-8', HOME: join(guard.entry, '../home') });
        expect(seen.XDG_CACHE_HOME?.startsWith(join(guard.entry, '../home'))).toBe(true);
        for (const name of ['ANTHROPIC_API_KEY', 'AZURE_DEVOPS_EXT_PAT', 'NODE_OPTIONS']) expect(seen, name).not.toHaveProperty(name);
        expect(run.stdout).not.toContain('probe-pat');
      } finally { await guard.dispose(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
