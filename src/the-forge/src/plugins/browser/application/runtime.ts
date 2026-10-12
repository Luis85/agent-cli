import type { TutorialPlan } from '../domain/tutorial.ts';
/** Browser operations are isolated behind this port; persistence belongs to the calling use case. */
export interface BrowserOptions {
  executablePath?: string;
  viewport: { width: number; height: number };
  timeoutMs: number;
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
  reason: 'available' | 'missing' | 'not-file' | 'not-executable' | 'inaccessible';
  nextStep: string | null;
}
export interface BrowserFlowRequest extends BrowserOptions { plan: TutorialPlan }
export interface BrowserFlowResult { screenshots: Array<BrowserImage & { stepId: string }>; browserVersion: string }
export interface BrowserRuntime {
  flow(request: BrowserFlowRequest): Promise<BrowserFlowResult>;
  status(executablePath?: string): Promise<BrowserStatus>;
  install(): Promise<BrowserStatus>;
  screenshot(request: ScreenshotRequest): Promise<BrowserImage>;
}
