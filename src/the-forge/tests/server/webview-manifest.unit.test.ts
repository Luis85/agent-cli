import { expect, it } from 'vitest';
import { isWebviewManifest } from '../../src/domain/server/webview-manifest.ts';

it('accepts only the manifest of the named webview with a nonempty name and the entry index.html', () => {
  expect(isWebviewManifest({ id: 'board', name: 'Board', entry: 'index.html' }, 'board')).toBe(true);
  for (const value of [
    null, [], 'board', { id: 'other', name: 'Board', entry: 'index.html' }, { id: 'board', name: ' ', entry: 'index.html' },
    { id: 'board', name: 7, entry: 'index.html' }, { id: 'board', name: 'Board', entry: 'main.html' }, { id: 'board', name: 'Board' },
  ]) expect(isWebviewManifest(value, 'board'), JSON.stringify(value)).toBe(false);
});
