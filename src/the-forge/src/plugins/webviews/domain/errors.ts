import { PluginFailure } from '../../../domain/shared/plugin-failure.ts';

type WebviewCode = 'WEBVIEW_INVALID' | 'WEBVIEW_BUILD_REQUIRED' | 'WEBVIEW_DRIFT' | 'WEBVIEW_PROJECT_REQUIRED';
export function webviewError(code: WebviewCode, message: string, details?: Record<string, unknown>): PluginFailure {
  return new PluginFailure(code, message, details);
}
export function ensureWebview(condition: unknown, code: WebviewCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw webviewError(code, message, details);
}
