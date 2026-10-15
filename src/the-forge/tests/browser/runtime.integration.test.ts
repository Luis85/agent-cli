import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { createBrowserRuntime } from '../../src/plugins/browser/infrastructure/runtime.ts';
import { tutorialPlan } from '../../src/plugins/browser/domain/tutorial.ts';

const roots: string[] = [], servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture(real = false) {
  const root = await mkdtemp(join(tmpdir(), 'forge-browser-runtime-')); roots.push(root);
  const packageRoot = join(root, 'browser-runtime/playwright-core');
  if (real) await cp(resolve('node_modules/playwright-core'), packageRoot, { recursive: true });
  else {
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'playwright-core', version: '1.64.0', exports: { '.': './index.js' } }));
    await writeFile(join(packageRoot, 'index.js'), `module.exports = { chromium: { executablePath: () => ${JSON.stringify(join(root, 'managed-browser'))} } };`);
  }
  return { root, packageRoot, runtime: createBrowserRuntime(root) };
}

describe('portable browser runtime boundaries', () => {
  it('reports a missing managed browser without launching or installing it', async () => {
    const { runtime, root } = await fixture();
    vi.stubEnv('FORGE_BROWSER_EXECUTABLE', undefined);
    expect(await runtime.status()).toEqual({ available: false, executablePath: join(root, 'managed-browser'), source: 'managed', version: '1.64.0', verification: 'executable-only', reason: 'missing' });
    expect(existsSync(join(root, 'managed-browser'))).toBe(false);
  });

  it('uses explicit executable selection before environment configuration', async () => {
    const { runtime } = await fixture();
    vi.stubEnv('FORGE_BROWSER_EXECUTABLE', '/missing/environment-browser');
    expect(await runtime.status()).toMatchObject({ available: false, source: 'environment', reason: 'missing' });
    expect(await runtime.status(process.execPath)).toMatchObject({ available: true, source: 'explicit', executablePath: process.execPath, verification: 'executable-only', reason: 'available' });
  });

  it('reports a directory as not-file and preserves the explicitly selected path', async () => {
    const { runtime, root } = await fixture();
    const result = await runtime.status(root);
    expect(result).toMatchObject({ available: false, executablePath: root, source: 'explicit', reason: 'not-file' });
    expect(await runtime.status(join(root, 'missing'))).toMatchObject({ reason: 'missing' });
  });

  it.skipIf(process.platform === 'win32')('distinguishes a non-executable file without running it', async () => {
    const { runtime, root } = await fixture();
    const file = join(root, 'selected-browser');
    await writeFile(file, 'This is not a browser and must never be executed.');
    await chmod(file, 0o600);
    expect(await runtime.status(file)).toMatchObject({ available: false, reason: 'not-executable' });
    await chmod(file, 0o700);
    expect(await runtime.status(file)).toMatchObject({ available: true, reason: 'available', verification: 'executable-only' });
    expect(await readFile(file, 'utf8')).toBe('This is not a browser and must never be executed.');
    expect(await runtime.status(join(file, 'child'))).toMatchObject({ reason: 'missing' });
  });

  it.skipIf(process.platform === 'win32')('reports filesystem access failures without exposing raw diagnostics', async () => {
    const { runtime, root } = await fixture();
    const file = join(root, 'loop');
    await symlink(file, file);
    expect(await runtime.status(file)).toMatchObject({ available: false, reason: 'inaccessible' });
  });

  it('uses an available environment executable without asserting browser compatibility', async () => {
    const { runtime } = await fixture();
    vi.stubEnv('FORGE_BROWSER_EXECUTABLE', process.execPath);
    expect(await runtime.status()).toMatchObject({ available: true, source: 'environment', verification: 'executable-only', reason: 'available' });
    expect(await runtime.status('/missing/explicit-browser')).toMatchObject({ available: false, source: 'explicit', reason: 'missing' });
  });

  it('executes the shipped Chromium installer without exposing child stdout', async () => {
    const { runtime, root, packageRoot } = await fixture();
    await writeFile(join(packageRoot, 'cli.js'), `const fs = require('node:fs');
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['install', 'chromium', '--no-shell'])) process.exit(2);
fs.writeFileSync(${JSON.stringify(join(root, 'managed-browser'))}, 'installed');
fs.chmodSync(${JSON.stringify(join(root, 'managed-browser'))}, 0o755);
fs.appendFileSync(${JSON.stringify(join(root, 'installer-count'))}, '1');
console.log('private installer progress');`);
    vi.stubEnv('FORGE_BROWSER_EXECUTABLE', '/missing/environment-browser');
    expect(await runtime.install()).toMatchObject({ available: true, source: 'managed', executablePath: join(root, 'managed-browser') });
    expect(await readFile(join(root, 'managed-browser'), 'utf8')).toBe('installed');
    expect(await runtime.install()).toMatchObject({ available: true, source: 'managed' });
    expect(await readFile(join(root, 'installer-count'), 'utf8')).toBe('1');
  });

  it('sanitizes installer failures instead of returning download URLs or fragments', async () => {
    const { runtime, packageRoot } = await fixture();
    await writeFile(join(packageRoot, 'cli.js'), "console.error('https://private.example/#token=secret'); process.exit(1);");
    await expect(runtime.install()).rejects.toMatchObject({ code: 'BROWSER_INSTALL_FAILED', message: expect.not.stringContaining('secret') });
  });

  it('reports incomplete runtime assets without exposing filesystem diagnostics', async () => {
    const { runtime, packageRoot } = await fixture();
    await rm(join(packageRoot, 'index.js'));
    await expect(runtime.status()).rejects.toMatchObject({ code: 'BROWSER_UNAVAILABLE', message: expect.stringContaining('complete Forge distribution') });
  });
});

const executable = process.env.FORGE_BROWSER_EXECUTABLE ?? (process.env.FORGE_BROWSER_TESTS === '1'
  ? chromium.executablePath()
  : process.env.FORGE_BROWSER_TESTS !== '0' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
describe.skipIf(!executable)('real isolated Chromium capture', () => {
  async function pageFixture() {
    const installed = await fixture(true);
    const server = createServer((request, response) => {
      if (request.url === '/waiting') { response.end('<title>Waiting</title><p>No ready marker</p>'); return; }
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><title>Capture fixture</title><style>body{height:1300px}</style>
<label>Name<input aria-label="Name"></label><label>Choice<select aria-label="Choice"><option value="a">A</option><option value="b">B</option></select></label>
<label><input type="checkbox" aria-label="Approved">Approved</label><button>Save</button><p data-testid="result">Draft</p><a target="_blank" href="/new-tab">Open another tab</a>
<script>document.querySelector('button').onclick=()=>{document.querySelector('[data-testid=result]').textContent=document.querySelector('input').value+':'+document.querySelector('select').value+':'+document.querySelector('[type=checkbox]').checked;document.querySelector('[data-testid=result]').id='ready'};</script>`);
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    return { ...installed, url: `http://127.0.0.1:${address.port}/`, options: { executablePath: executable!, viewport: { width: 640, height: 480 }, timeoutMs: 8_000 } };
  }

  it('captures viewport and full page PNGs with sanitized URL metadata', async () => {
    const { runtime, url, options } = await pageFixture();
    const viewport = await runtime.screenshot({ ...options, url: `${url}#token=private`, fullPage: false });
    expect(viewport).toMatchObject({ width: 640, height: 480, url, title: 'Capture fixture' });
    expect(Buffer.from(viewport.bytes.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
    const full = await runtime.screenshot({ ...options, url, fullPage: true, waitForSelector: 'button' });
    expect(full.height).toBeGreaterThan(1_300);
    expect(full.url).not.toContain('private');
  }, 20_000);

  it('replays declarative form actions and captures each requested tutorial step', async () => {
    const { runtime, url, options } = await pageFixture();
    vi.stubEnv('FORGE_TUTORIAL_NAME', 'Example');
    const plan = tutorialPlan({ version: 1, title: 'Form tutorial', startUrl: url, viewport: options.viewport, steps: [
      { id: 'before', title: 'Before', actions: [] },
      { id: 'complete', title: 'Complete', actions: [
        { type: 'fill', locator: { label: 'Name' }, valueFromEnv: 'FORGE_TUTORIAL_NAME' },
        { type: 'select', locator: { label: 'Choice' }, value: 'b' },
        { type: 'check', locator: { label: 'Approved' }, checked: true },
        { type: 'press', locator: { label: 'Name' }, key: 'End' },
        { type: 'click', locator: { role: 'button', name: 'Save' } },
        { type: 'wait', locator: { css: '#ready' } },
        { type: 'wait', locator: { testId: 'result' } },
      ] },
    ] });
    const result = await runtime.flow({ ...options, plan });
    expect(result.browserVersion).toMatch(/^\d+\./);
    expect(result.screenshots.map(image => image.stepId)).toEqual(['before', 'complete']);
    expect(result.screenshots[0]!.bytes).not.toEqual(result.screenshots[1]!.bytes);
    expect(result.screenshots.every(image => image.width === 640 && image.url === url)).toBe(true);
  }, 20_000);

  it('bounds readiness failures and keeps tokens out of diagnostics', async () => {
    const { runtime, url, options } = await pageFixture();
    await expect(runtime.screenshot({ ...options, timeoutMs: 1_500, url: `${url}waiting#token=private`, fullPage: false, waitForSelector: '#never' }))
      .rejects.toMatchObject({ code: 'BROWSER_CAPTURE_FAILED', message: expect.not.stringContaining('private') });
    const recovered = await runtime.screenshot({ ...options, url, fullPage: false });
    expect(recovered.width).toBe(640);
  }, 15_000);

  it('rejects a tutorial popup instead of capturing the original page as success', async () => {
    const { runtime, url, options } = await pageFixture();
    const plan = tutorialPlan({ version: 1, title: 'Popup flow', startUrl: url, steps: [
      { id: 'opens-popup', title: 'Open another tab', actions: [{ type: 'click', locator: { role: 'link', name: 'Open another tab' } }] },
    ] });
    await expect(runtime.flow({ ...options, plan })).rejects.toMatchObject({ code: 'BROWSER_FLOW_FAILED',
      message: expect.stringContaining('one browser tab'), details: { stepId: 'opens-popup' } });
    expect((await runtime.screenshot({ ...options, url, fullPage: false })).width).toBe(640);
  }, 15_000);
});
