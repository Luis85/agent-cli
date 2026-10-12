import type { CommandContext } from '../../../application/plugins/registry.ts';
import { AppError, ensure } from '../../../domain/shared/errors.ts';
import { ensureBrowser } from '../domain/errors.ts';
import { expectedRevision, imageMarkdown, reportedUrl, screenshotOutput, validateScreenshot } from './requests.ts';
import type { BrowserImage, BrowserRuntime, ScreenshotRequest } from './runtime.ts';

export interface ScreenshotInput extends ScreenshotRequest { out: string; ifMatch?: string }

function imageDimensions(image: BrowserImage) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  ensureBrowser(image.bytes instanceof Uint8Array && image.bytes.length >= 24 && signature.every((byte, index) => image.bytes[index] === byte),
    'BROWSER_CAPTURE_FAILED', 'The browser did not return a PNG screenshot.');
  const header = new DataView(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength);
  const width = header.getUint32(16), height = header.getUint32(20);
  ensureBrowser(width > 0 && height > 0 && image.width === width && image.height === height && Number.isFinite(Date.parse(image.capturedAt)),
    'BROWSER_CAPTURE_FAILED', 'The browser returned invalid screenshot metadata.');
  return { width, height };
}

/** Capture bytes before the guarded commit; browser failures cannot leave partial images behind. */
export class BrowserScreenshot {
  constructor(private readonly runtime: BrowserRuntime) {}

  async run(context: CommandContext, input: ScreenshotInput) {
    const request = validateScreenshot(input);
    const path = screenshotOutput(input.out), revision = expectedRevision(input.ifMatch);
    // Check-only dry-run guards validate containment and replacement conflicts before any browser/network activity.
    await context.workspace.files.commit({ guards: [{ path, ...(revision === undefined ? {} : { expectedRevision: revision }) }] }, true);
    const target = await context.workspace.files.stat(path).catch(error => {
      if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
      throw error;
    });
    ensure(target === null || target.kind === 'file', 'INVALID_PATH', 'Screenshot output must name a regular file, not a directory.');
    const plan = { requestedUrl: reportedUrl(request.url), out: path, viewport: request.viewport, fullPage: request.fullPage,
      ...(request.waitForSelector === undefined ? {} : { waitForSelector: request.waitForSelector }), timeoutMs: request.timeoutMs };
    if (context.workspace.dryRun) return { dryRun: true, captured: false, plan, changes: [] };
    const image = await this.runtime.screenshot(request);
    const dimensions = imageDimensions(image);
    const finalUrl = reportedUrl(image.url);
    const result = await context.workspace.write([{ path, bytes: image.bytes, ...(revision === undefined ? {} : { expectedRevision: revision }) }]);
    const change = result.changes[0]!;
    return { ...result, captured: true, path, revision: change.revision, bytes: change.bytes, ...dimensions,
      requestedUrl: plan.requestedUrl, finalUrl, capturedAt: new Date(image.capturedAt).toISOString(), markdown: imageMarkdown(path) };
  }
}
