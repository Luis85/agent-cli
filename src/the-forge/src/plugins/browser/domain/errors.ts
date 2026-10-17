import { PluginFailure } from '../../../domain/shared/plugin-failure.ts';

export type BrowserCode = 'BROWSER_UNAVAILABLE' | 'BROWSER_CAPTURE_FAILED' | 'BROWSER_INSTALL_FAILED' | 'BROWSER_FLOW_INVALID' | 'BROWSER_FLOW_FAILED';
export function browserError(code: BrowserCode, message: string, details?: Record<string, unknown>): PluginFailure {
  return new PluginFailure(code, message, details);
}
export function ensureBrowser(condition: unknown, code: BrowserCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw browserError(code, message, details);
}
