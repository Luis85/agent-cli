import type { TutorialPlan } from '../domain/tutorial.ts';
/**
 * Whether Chromium renders pages inside its operating-system sandbox. `disabled-root`: running as root on Linux,
 * where Chromium cannot start sandboxed; `disabled-option`: the caller opted out with `--no-browser-sandbox`.
 */
export type BrowserSandbox = 'enabled' | 'disabled-root' | 'disabled-option';
/** Browser operations are isolated behind this port; persistence belongs to the calling use case. */
export interface BrowserOptions {
  executablePath?: string;
  viewport: { width: number; height: number };
  timeoutMs: number;
  /** Explicit opt-out of the Chromium sandbox; the sandbox is on otherwise, except as root on Linux. */
  disableSandbox?: boolean;
}
export interface ScreenshotRequest extends BrowserOptions {
  url: string;
  fullPage: boolean;
  waitForSelector?: string;
}
export interface BrowserImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  url: string;
  title: string;
  capturedAt: string;
}
export interface BrowserStatus {
  available: boolean;
  executablePath: string | null;
  source: 'explicit' | 'environment' | 'managed';
  /** Version of the packaged Playwright runtime, not the browser executable. */
  version: string;
  /** Filesystem checks only; no browser process was launched. */
  verification: 'executable-only';
  /** Language-independent outcome; presentation derives localized recovery guidance from it and `source`. */
  reason: 'available' | 'missing' | 'not-file' | 'not-executable' | 'inaccessible';
  /** The sandbox a launch without `--no-browser-sandbox` would use. */
  sandbox: Exclude<BrowserSandbox, 'disabled-option'>;
}
/** A screenshot with the sandbox mode the browser actually ran in. */
export interface BrowserCapture extends BrowserImage { sandbox: BrowserSandbox }
export interface BrowserFlowRequest extends BrowserOptions { plan: TutorialPlan }
export interface BrowserFlowResult { screenshots: Array<BrowserImage & { stepId: string }>; browserVersion: string; sandbox: BrowserSandbox }
export interface BrowserRuntime {
  flow(request: BrowserFlowRequest): Promise<BrowserFlowResult>;
  status(executablePath?: string): Promise<BrowserStatus>;
  install(): Promise<BrowserStatus>;
  screenshot(request: ScreenshotRequest): Promise<BrowserCapture>;
}
