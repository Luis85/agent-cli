import { ensure } from '../../../domain/shared/errors.ts';
import { vaultPath } from '../../../domain/documents/file.ts';
import type { ScreenshotRequest } from './runtime.ts';

/**
 * Keep credentials out of invocation plans, reports and tutorials: URL fragments can carry localhost launch tokens
 * and query strings OAuth codes or access tokens after redirects.
 */
export function reportedUrl(input: string): string {
  const url = new URL(input);
  url.hash = '';
  url.search = '';
  url.username = '';
  url.password = '';
  return url.href;
}

function browserUrl(input: string): string {
  let url: URL | undefined;
  try { url = new URL(input); } catch { /* Report the same actionable input error below. */ }
  ensure(url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
    'INVALID_ARGUMENT', 'Use an absolute HTTP or HTTPS URL without embedded credentials.');
  return url.href;
}

export function screenshotOutput(path: string): string {
  vaultPath(path);
  ensure(/\.png$/i.test(path), 'INVALID_ARGUMENT', '--out must name a project-relative PNG file.');
  return path;
}

export function browserViewport(width = 1440, height = 900) {
  ensure(Number.isSafeInteger(width) && width >= 1 && width <= 7680 && Number.isSafeInteger(height) && height >= 1 && height <= 7680,
    'INVALID_ARGUMENT', 'Viewport width and height must be integers from 1 to 7680 pixels.');
  return { width, height };
}

export function browserTimeout(timeoutMs = 30_000): number {
  ensure(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120_000,
    'INVALID_ARGUMENT', '--timeout-ms must be an integer from 1 to 120000.');
  return timeoutMs;
}

export function browserExecutable(executablePath: string | undefined): string | undefined {
  ensure(executablePath === undefined || (typeof executablePath === 'string' && executablePath.trim().length > 0 && !executablePath.includes('\0')),
    'INVALID_ARGUMENT', '--browser-executable must name a browser executable.');
  return executablePath;
}

export function validateScreenshot(request: ScreenshotRequest): ScreenshotRequest {
  ensure(typeof request.fullPage === 'boolean', 'INVALID_ARGUMENT', '--full-page must be boolean.');
  ensure(request.waitForSelector === undefined || (typeof request.waitForSelector === 'string' && request.waitForSelector.trim().length > 0 && request.waitForSelector.length <= 2048),
    'INVALID_ARGUMENT', '--wait-for-selector must be a nonempty selector of at most 2048 characters.');
  browserExecutable(request.executablePath);
  return { ...request, url: browserUrl(request.url), viewport: browserViewport(request.viewport.width, request.viewport.height), timeoutMs: browserTimeout(request.timeoutMs) };
}

export function expectedRevision(revision: string | undefined): string | undefined {
  ensure(revision === undefined || /^[a-f0-9]{64}$/.test(revision), 'INVALID_ARGUMENT', '--if-match must be a SHA-256 revision from read or browser validate.');
  return revision;
}

/** Angle brackets and URI escaping keep spaces and parentheses safe in a Markdown destination. */
export function imageMarkdown(path: string, title = 'Screenshot'): string {
  const destination = path.split('/').map(segment => encodeURIComponent(segment).replaceAll('(', '%28').replaceAll(')', '%29')).join('/');
  const label = title.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]').replaceAll('\n', ' ');
  return `![${label}](<${destination}>)`;
}
