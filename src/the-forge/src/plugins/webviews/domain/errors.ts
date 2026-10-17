import { codedError } from '../../../domain/shared/errors.ts';

type WebviewCode = 'WEBVIEW_INVALID' | 'WEBVIEW_BUILD_REQUIRED' | 'WEBVIEW_DRIFT' | 'WEBVIEW_PROJECT_REQUIRED';
export function webviewError(code: WebviewCode, message: string, details?: Record<string, unknown>) {
  return codedError(code, message, code === 'WEBVIEW_DRIFT' ? 5 : 2, details);
}
export function ensureWebview(condition: unknown, code: WebviewCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw webviewError(code, message, details);
}
