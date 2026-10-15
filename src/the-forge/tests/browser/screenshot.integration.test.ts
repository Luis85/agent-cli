import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserScreenshot, type ScreenshotInput } from '../../src/plugins/browser/application/screenshot.ts';
import type { BrowserImage, BrowserRuntime } from '../../src/plugins/browser/application/runtime.ts';
import { browserError } from '../../src/plugins/browser/domain/errors.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { scopeServices } from '../support/metadata.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=', 'base64');
let root: string, files: NodeFiles;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-browser-app-')); files = await NodeFiles.at(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function context(dryRun = false): CommandContext & { events: EventBus } {
  const events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  const workspace = new Workspace(files, new ObsidianDocuments(), events, dryRun);
  return { workspace, events, root, workspaceRoot: root, project: null, ...scopeServices(workspace, events), input: async () => new Uint8Array() };
}
const request = (overrides: Partial<ScreenshotInput> = {}): ScreenshotInput => ({
  url: 'https://example.test/page#token=private', out: 'docs/screenshots/example.png',
  viewport: { width: 1440, height: 900 }, fullPage: false, timeoutMs: 30_000, ...overrides,
});
const image = (): BrowserImage => ({ bytes: png, width: 1, height: 1, url: 'https://example.test/final#private', title: 'Example', capturedAt: '2026-10-11T00:00:00Z' });
function runtime(capture = vi.fn(async () => image())): BrowserRuntime {
  return {
    screenshot: capture,
    async status() { return { available: true, executablePath: '/browser', source: 'managed', version: '1.64.0', verification: 'executable-only', reason: 'available' }; },
    async install() { throw new Error('Screenshots must not install browsers'); },
    async flow() { throw new Error('Screenshots must not replay tutorials'); },
  };
}

describe('guarded webpage screenshots', () => {
  it('previews output intent without launching a browser, creating files or exposing the URL fragment', async () => {
    const capture = vi.fn(async () => image());
    const ctx = context(true);
    const result = await new BrowserScreenshot(runtime(capture)).run(ctx, request());
    expect(result).toMatchObject({ dryRun: true, captured: false, changes: [], plan: {
      requestedUrl: 'https://example.test/page', out: 'docs/screenshots/example.png', viewport: { width: 1440, height: 900 },
    } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(capture).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
    expect(ctx.events.history.filter(event => event.id.startsWith('vault.'))).toEqual([]);
  });

  it('writes real PNG bytes with a revision, document reference and observed dimensions', async () => {
    const ctx = context();
    const result = await new BrowserScreenshot(runtime()).run(ctx, request({ out: 'docs/screenshot (mobile).png' }));
    expect(result).toMatchObject({ dryRun: false, captured: true, path: 'docs/screenshot (mobile).png', width: 1, height: 1,
      bytes: png.length, capturedAt: '2026-10-11T00:00:00.000Z', requestedUrl: 'https://example.test/page', finalUrl: 'https://example.test/final',
      markdown: '![Screenshot](<docs/screenshot%20%28mobile%29.png>)',
    });
    expect(await readFile(join(root, 'docs/screenshot (mobile).png'))).toEqual(png);
    expect(result).toHaveProperty('revision', (await files.read('docs/screenshot (mobile).png')).revision);
    expect(ctx.events.history.some(event => event.id === 'vault.create')).toBe(true);
  });

  it('checks existing output revisions before capturing and applies a reviewed replacement', async () => {
    const capture = vi.fn(async () => image()), service = new BrowserScreenshot(runtime(capture));
    await service.run(context(), request());
    capture.mockClear();
    await expect(service.run(context(), request())).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.run(context(true), request({ ifMatch: '0'.repeat(64) }))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(capture).not.toHaveBeenCalled();
    const revision = (await files.read('docs/screenshots/example.png')).revision;
    expect(await service.run(context(), request({ ifMatch: revision }))).toMatchObject({ captured: true });
  });

  it('preserves a concurrent edit made while the browser captures', async () => {
    await new BrowserScreenshot(runtime()).run(context(), request());
    const before = await files.read('docs/screenshots/example.png');
    const capture = vi.fn(async () => {
      await writeFile(join(root, 'docs/screenshots/example.png'), 'a concurrent replacement');
      return image();
    });
    await expect(new BrowserScreenshot(runtime(capture)).run(context(), request({ ifMatch: before.revision }))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(join(root, 'docs/screenshots/example.png'), 'utf8')).toBe('a concurrent replacement');
  });

  it('does not persist output after browser failures or malformed captures', async () => {
    const capture = vi.fn(async (): Promise<BrowserImage> => { throw browserError('BROWSER_CAPTURE_FAILED', 'Failed'); });
    await expect(new BrowserScreenshot(runtime(capture)).run(context(), request())).rejects.toMatchObject({ code: 'BROWSER_CAPTURE_FAILED' });
    const malformed = vi.fn(async () => ({ ...image(), bytes: new Uint8Array([0, 1, 2]) }));
    await expect(new BrowserScreenshot(runtime(malformed)).run(context(), request())).rejects.toMatchObject({ code: 'BROWSER_CAPTURE_FAILED' });
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    { url: 'file:///tmp/private' }, { url: 'https://user:password@example.test' }, { out: '../escape.png' }, { out: 'docs/image.svg' },
    { viewport: { width: 0, height: 900 } }, { viewport: { width: 1440, height: 7681 } }, { timeoutMs: 120_001 }, { waitForSelector: '   ' },
  ])('rejects invalid input before starting a browser: %j', async overrides => {
    const capture = vi.fn(async () => image());
    await expect(new BrowserScreenshot(runtime(capture)).run(context(), request(overrides))).rejects.toMatchObject({ code: expect.stringMatching(/^INVALID_/) });
    expect(capture).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects linked output directories before starting a browser', async () => {
    const capture = vi.fn(async () => image());
    await mkdir(join(root, 'real'));
    await symlink(join(root, 'real'), join(root, 'linked'), 'junction');
    await expect(new BrowserScreenshot(runtime(capture)).run(context(), request({ out: 'linked/image.png' }))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(capture).not.toHaveBeenCalled();
    expect(await readdir(join(root, 'real'))).toEqual([]);
  });
});
