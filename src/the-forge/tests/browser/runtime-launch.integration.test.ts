import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createBrowserRuntime, maxTutorialMs, tutorialDeadline } from '../../src/plugins/browser/infrastructure/runtime.ts';
import { tutorialPlan } from '../../src/plugins/browser/domain/tutorial.ts';

// A fake Playwright module loaded through the runtime's anchored require: it records launch and screenshot options.
interface Recorded { launch?: Record<string, unknown>; screenshots: Array<{ mask?: Array<{ description: string }> }>; closed: number }
const fakeKey = '__forgeFakePlaywright';
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>)[fakeKey];
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function fakePlaywright(recorded: Recorded, actionDelayMs = 0) {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(10, 16); png.writeUInt32BE(10, 20);
  let url = 'about:blank';
  const locator = (description: string) => ({ description,
    click: async () => { await sleep(actionDelayMs); }, fill: async () => { await sleep(actionDelayMs); } });
  const page: Record<string, unknown> = {
    on: () => {}, context: () => context, url: () => url, title: async () => 'Fake page',
    goto: async (target: string) => { url = target; },
    screenshot: async (options: Recorded['screenshots'][number]) => { recorded.screenshots.push(options); return png; },
    getByLabel: (label: string) => locator(`label=${label}`), locator: (css: string) => locator(`css=${css}`),
  };
  const context = { setDefaultTimeout: () => {}, setDefaultNavigationTimeout: () => {}, route: async () => {}, on: () => {},
    pages: () => [page], newPage: async () => page };
  const browser = { newContext: async () => context, version: () => '1.0.0-fake', close: async () => { recorded.closed++; } };
  return { chromium: { executablePath: () => process.execPath, launch: async (options: Record<string, unknown>) => { recorded.launch = options; return browser; } } };
}

async function fixture(actionDelayMs = 0) {
  const root = await mkdtemp(join(tmpdir(), 'forge-browser-launch-')); roots.push(root);
  const packageRoot = join(root, 'browser-runtime/playwright-core');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'playwright-core', version: '1.64.0', exports: { '.': './index.js' } }));
  await writeFile(join(packageRoot, 'index.js'), `module.exports = globalThis.${fakeKey};`);
  const recorded: Recorded = { screenshots: [], closed: 0 };
  (globalThis as Record<string, unknown>)[fakeKey] = fakePlaywright(recorded, actionDelayMs);
  return { runtime: createBrowserRuntime(root), recorded };
}
const options = { viewport: { width: 800, height: 600 }, timeoutMs: 5_000 };
const asUser = (uid: number) => { if (process.getuid) vi.spyOn(process, 'getuid').mockReturnValue(uid); };

describe('browser launch policy', () => {
  it('launches Chromium sandboxed by default and reports the sandbox in status and results', async () => {
    asUser(1000);
    const { runtime, recorded } = await fixture();
    expect(await runtime.status()).toMatchObject({ available: true, sandbox: 'enabled' });
    const image = await runtime.screenshot({ ...options, url: 'https://example.test/', fullPage: false });
    expect(recorded.launch).toMatchObject({ headless: true, chromiumSandbox: true });
    expect(image).toMatchObject({ sandbox: 'enabled', width: 10, height: 10 });
    expect(recorded.closed).toBe(1);
  });

  it('disables the sandbox only after an explicit opt-out and says so', async () => {
    asUser(1000);
    const { runtime, recorded } = await fixture();
    const image = await runtime.screenshot({ ...options, url: 'https://example.test/', fullPage: false, disableSandbox: true });
    expect(recorded.launch).toMatchObject({ chromiumSandbox: false });
    expect(image.sandbox).toBe('disabled-option');
  });

  it.runIf(process.platform === 'linux')('runs unsandboxed as root on Linux, where Chromium cannot sandbox itself, and reports why', async () => {
    asUser(0);
    const { runtime, recorded } = await fixture();
    expect(await runtime.status()).toMatchObject({ sandbox: 'disabled-root' });
    const plan = tutorialPlan({ version: 1, title: 'Root', startUrl: 'https://example.test/', steps: [{ id: 'open', title: 'Open', actions: [] }] });
    expect(await runtime.flow({ ...options, plan })).toMatchObject({ sandbox: 'disabled-root', browserVersion: '1.0.0-fake' });
    expect(recorded.launch).toMatchObject({ chromiumSandbox: false });
  });
});

describe('tutorial runtime safeguards', () => {
  it('masks inputs filled from environment variables in every later screenshot, but not literal inputs', async () => {
    vi.stubEnv('FORGE_TUTORIAL_PASSWORD', 'secret-value');
    const { runtime, recorded } = await fixture();
    const plan = tutorialPlan({ version: 1, title: 'Sign in', startUrl: 'https://example.test/login', steps: [
      { id: 'name', title: 'Name', actions: [{ type: 'fill', locator: { label: 'Name' }, value: 'Ada' }] },
      { id: 'password', title: 'Password', actions: [{ type: 'fill', locator: { label: 'Password' }, valueFromEnv: 'FORGE_TUTORIAL_PASSWORD' }] },
      { id: 'after', title: 'After', actions: [{ type: 'click', locator: { css: 'button' } }] },
    ] });
    const result = await runtime.flow({ ...options, plan });
    expect(result.screenshots.map(image => image.stepId)).toEqual(['name', 'password', 'after']);
    expect(recorded.screenshots[0]).not.toHaveProperty('mask');
    expect(recorded.screenshots.slice(1).map(options => options.mask?.map(locator => locator.description))).toEqual([['label=Password'], ['label=Password']]);
  });

  it('fails a tutorial whose actions outlast its total time budget with BROWSER_FLOW_FAILED and closes the browser', async () => {
    const { runtime, recorded } = await fixture(150);
    const plan = tutorialPlan({ version: 1, title: 'Slow', startUrl: 'https://example.test/', steps: [
      { id: 'slow', title: 'Slow', actions: Array.from({ length: 6 }, () => ({ type: 'click', locator: { css: 'button' } })) },
    ] });
    const request = { ...options, timeoutMs: 50, plan };
    expect(tutorialDeadline(request)).toBe(50 * 8);
    const started = performance.now();
    await expect(runtime.flow(request)).rejects.toMatchObject({ code: 'BROWSER_FLOW_FAILED', message: expect.stringContaining('total time budget'), details: { stepId: 'slow' } });
    expect(performance.now() - started).toBeLessThan(800);
    expect(recorded.closed).toBe(1);
  });

  it('caps the total tutorial budget whatever the per-operation timeout', () => {
    const steps = Array.from({ length: 100 }, (_, index) => ({ id: `step-${index}`, title: 'Step', actions: Array.from({ length: 5 }, () => ({ type: 'click', locator: { css: 'a' } })) }));
    const plan = tutorialPlan({ version: 1, title: 'Long', startUrl: 'https://example.test/', steps });
    expect(tutorialDeadline({ ...options, timeoutMs: 120_000, plan })).toBe(maxTutorialMs);
  });
});
