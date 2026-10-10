import { describe, expect, it } from 'vitest';
import { localizedLibraryResult } from '../../src/application/plugins/library-commands.ts';
import { relativePathIssues, relativePathSetting } from '../../src/application/plugins/plugin-settings.ts';
import type { CommandContext } from '../../src/application/plugins/registry.ts';

const context = (language: 'en' | 'de', messages: Record<string, string>) =>
  ({ language, t: (key: string) => messages[key] ?? key }) as unknown as CommandContext;
const empty = { directory: 'my library', status: 'empty', count: 0, nextStep: 'Run things init --library my library, or add a Markdown thing definition.' };

describe('definition library command helpers for core plugins', () => {
  it('localizes an empty library\'s next step from the plugin\'s emptyLibrary message', () => {
    const german = context('de', { emptyLibrary: 'Führen Sie {command} init --library {directory} aus.' });
    expect(localizedLibraryResult('things', german, empty)).toEqual({ ...empty, nextStep: 'Führen Sie things init --library my library aus.' });
  });

  it('keeps English results, ready libraries and plugins without the message unchanged', () => {
    const german = context('de', { emptyLibrary: 'Führen Sie {command} init --library {directory} aus.' });
    expect(localizedLibraryResult('things', context('en', { emptyLibrary: 'unused' }), empty)).toBe(empty);
    const ready = { directory: 'library', status: 'ready', count: 1 };
    expect(localizedLibraryResult('things', german, ready)).toBe(ready);
    expect(localizedLibraryResult('things', context('de', {}), empty)).toBe(empty);
  });

  it('accepts contained relative path settings, dropping trailing slashes, and names every escaping one', () => {
    expect(relativePathSetting('library//')).toBe('library');
    expect(relativePathIssues('things', { library: 'library/', output: 'src/things' }, ['library', 'output'])).toEqual([]);
    expect(relativePathIssues('things', { library: '../escape', output: '/absolute' }, ['library', 'output'])).toEqual([
      'plugins.settings.things.library: must be a contained workspace-relative path',
      'plugins.settings.things.output: must be a contained workspace-relative path',
    ]);
  });
});
