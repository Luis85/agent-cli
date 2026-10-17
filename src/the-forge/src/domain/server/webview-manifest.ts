import { isRecord } from '../shared/errors.ts';

/** The `manifest.json` of a static webview build; its id names the webview's folder. */
export interface WebviewManifest { id: string; name: string; entry: 'index.html' }

/** Whether `value` is the manifest of webview `id`: the same id, a nonempty name and the entry `index.html`. */
export function isWebviewManifest(value: unknown, id: string): value is WebviewManifest {
  return isRecord(value) && value.id === id && typeof value.name === 'string' && value.name.trim().length > 0 && value.entry === 'index.html';
}
