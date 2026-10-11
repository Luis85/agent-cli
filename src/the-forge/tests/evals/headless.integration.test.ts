import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The eval driver's process runner (scripts/eval/process.mjs) against real Node child processes; no model runs. */
const processModule = pathToFileURL(resolve('scripts/eval/process.mjs')).href;
const folders: string[] = [];
afterEach(async () => {
  vi.doUnmock('node:child_process');
  vi.resetModules();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
const folder = async () => { const path = await realpath(await mkdtemp(join(tmpdir(), 'forge-headless-'))); folders.push(path); return path; };

/** Whether `pid` still runs; a zombie that only awaits reaping by its new parent has ended. */
async function alive(pid: number) {
  try { process.kill(pid, 0); } catch { return false; }
  return !(await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')).match(/^\d+ \(.*\) Z/);
}

describe('the headless runner', () => {
  it('redacts a secret before it shortens the standard error of a failed run', async () => {
    const { headless } = await import('../../scripts/eval/process.mjs');
    const secret = 'sk-ant-SECRETPREFIX-0123456789abcdef0123456789';
    vi.stubEnv('FORGE_HEADLESS_PROBE_TOKEN', secret);
    try {
      const script = "process.stderr.write('x'.repeat(1985) + process.env.FORGE_HEADLESS_PROBE_TOKEN); process.exit(1);";
      const failure = await headless(process.execPath, ['-e', script], process.cwd(), 30_000).then(() => undefined, (error: Error) => error);
      expect(failure?.message).toMatch(/x\*\*\*$/);
      expect(failure?.message).not.toContain(secret.slice(0, 7));
    } finally { vi.unstubAllEnvs(); }
  });

  it('on Windows, leaves an exited agent alone instead of ending its tree by a reusable process id', async () => {
    const taskkill = vi.fn(() => ({ status: 0 }));
    vi.doMock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawnSync: taskkill }));
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    let module: typeof import('../../scripts/eval/process.mjs');
    try { module = await import('../../scripts/eval/process.mjs'); } finally { Object.defineProperty(process, 'platform', platform); }
    expect(await module.headless(process.execPath, ['-e', 'process.stdout.write(\'{"type":"result"}\')'], process.cwd(), 60_000)).toBe('{"type":"result"}');
    expect(taskkill).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.platform === 'win32')('a signal to the eval driver', () => {
  // POSIX only: the agent leads its own process group there, so a terminal's Ctrl+C reaches only the driver.
  it('ends the agent process group, then ends the driver with the same signal', async () => {
    const dir = await folder();
    const agent = "const { spawn } = require('node:child_process'); const tool = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('node:fs').writeFileSync(process.argv[1], JSON.stringify([process.pid, tool.pid])); setInterval(() => {}, 1000);";
    await writeFile(join(dir, 'driver.mjs'), `import { headless } from ${JSON.stringify(processModule)};\nawait headless(process.execPath, ['-e', ${JSON.stringify(agent)}, ${JSON.stringify(join(dir, 'pids.json'))}], ${JSON.stringify(dir)}, 600_000);\n`);
    // The driver leads its own group, like the foreground job a terminal sends SIGINT to.
    const driver = spawn(process.execPath, [join(dir, 'driver.mjs')], { detached: true, stdio: 'ignore' });
    const ended = new Promise<NodeJS.Signals | null>(resolvePromise => driver.on('exit', (_code, signal) => resolvePromise(signal)));
    const pids = await vi.waitFor(async () => JSON.parse(await readFile(join(dir, 'pids.json'), 'utf8')) as number[], { timeout: 10_000, interval: 100 });
    try {
      process.kill(-driver.pid!, 'SIGINT');
      expect(await ended).toBe('SIGINT');
      for (const pid of pids) await vi.waitFor(async () => expect(await alive(pid), `process ${pid}`).toBe(false), { timeout: 5000, interval: 100 });
    } finally {
      // A failing run must not leave the agent's group behind.
      try { process.kill(-pids[0]!, 'SIGKILL'); } catch { /* already ended */ }
    }
  }, 30_000);
});
