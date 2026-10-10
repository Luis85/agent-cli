import { describe, expect, it } from 'vitest';
import type { MetadataChange } from '../../src/application/metadata/ports.ts';
import { MemoryFiles, metadataIndex, metadataState } from '../support/metadata.ts';

const canvas = JSON.stringify({ nodes: [{ id: 'n1', type: 'file', file: 'Notes/Plan.md', subpath: '#Plan', x: 0, y: 0, width: 10, height: 10 }] });
const vault = () => new MemoryFiles({
  'Notes/Plan.md': '# Plan\nSee [[Ideas]], [[Missing]], [[Brainstorm]] and [[Ideas#Top|top]].\n',
  'Notes/Ideas.md': '---\naliases: [Brainstorm]\n---\nBack to [[Plan]], ![[diagram.png]] and [[Target]].\n',
  'A/Target.md': '', 'B/Target.md': '', 'Assets/diagram.png': 'bytes', 'Board.canvas': canvas,
  'Bad.md': '---\nx: [\n---\n', '.obsidian/app.json': '{}', '.hidden/Note.md': '[[Plan]]',
});

describe('kernel metadata cache', () => {
  it('indexes visible files and resolves links into Obsidian-shaped maps', async () => {
    const cache = await metadataIndex(vault()).load();
    expect(cache.files()).toEqual(['A/Target.md', 'Assets/diagram.png', 'B/Target.md', 'Bad.md', 'Board.canvas', 'Notes/Ideas.md', 'Notes/Plan.md']);
    expect(cache.resolvedLinks).toEqual({
      'A/Target.md': {}, 'B/Target.md': {}, 'Board.canvas': { 'Notes/Plan.md': 1 },
      'Notes/Ideas.md': { 'Notes/Plan.md': 1, 'Assets/diagram.png': 1 }, 'Notes/Plan.md': { 'Notes/Ideas.md': 3 },
    });
    expect(cache.unresolvedLinks).toEqual({ 'A/Target.md': {}, 'B/Target.md': {}, 'Board.canvas': {}, 'Notes/Ideas.md': { Target: 1 }, 'Notes/Plan.md': { Missing: 1 } });
    expect(cache.references('Notes/Ideas.md').map(item => [item.kind, item.resolution])).toEqual([
      ['link', { status: 'resolved', path: 'Notes/Plan.md', via: 'path' }],
      ['embed', { status: 'resolved', path: 'Assets/diagram.png', via: 'path' }],
      ['link', { status: 'unresolved', reason: 'ambiguous', via: 'path', linkpath: 'Target', candidates: ['A/Target.md', 'B/Target.md'] }],
    ]);
    expect(cache.references('Notes/Plan.md')[2]!.resolution).toEqual({ status: 'resolved', path: 'Notes/Ideas.md', via: 'alias' });
    expect(cache.getFileCache('Assets/diagram.png')).toBeNull();
    expect(cache.getFileCache('Bad.md')).toBeNull();
    expect(cache.issues()).toEqual([{ path: 'Bad.md', code: 'INVALID_YAML', message: expect.any(String) }]);
    expect(JSON.parse(JSON.stringify(metadataState(cache)))).toEqual(metadataState(cache));
  });

  it('lists backlinks with their source, kind and position', async () => {
    const cache = await metadataIndex(vault()).load();
    expect(cache.backlinks('Notes/Plan.md').map(({ source, kind, reference }) => [source, kind, reference.original, 'position' in reference ? reference.position.start : null])).toEqual([
      ['Board.canvas', 'canvas', 'Notes/Plan.md', null],
      ['Notes/Ideas.md', 'link', '[[Plan]]', { line: 3, col: 8, offset: 38 }],
    ]);
    expect(cache.backlinks('Notes/Ideas.md').map(item => item.reference.original)).toEqual(['[[Ideas]]', '[[Brainstorm]]', '[[Ideas#Top|top]]']);
    expect(cache.backlinks('A/Target.md')).toEqual([]);
  });

  it('answers linkpath and link text queries without alias fallback', async () => {
    const cache = await metadataIndex(vault()).load();
    expect(cache.getFirstLinkpathDest('Ideas#Top', 'Root.md')).toBe('Notes/Ideas.md');
    expect(cache.getFirstLinkpathDest('', 'Notes/Plan.md')).toBe('Notes/Plan.md');
    expect(cache.getFirstLinkpathDest('Brainstorm', 'Root.md')).toBeNull();
    expect(cache.getFirstLinkpathDest('Target', 'Root.md')).toBeNull();
    expect(cache.fileToLinktext('Notes/Plan.md', 'Root.md')).toBe('Plan');
    expect(cache.fileToLinktext('A/Target.md', 'Root.md')).toBe('A/Target');
    expect(cache.fileToLinktext('Notes/Plan.md', 'Root.md', false)).toBe('Plan.md');
    expect(cache.fileToLinktext('Assets/diagram.png', 'Root.md')).toBe('diagram.png');
  });
});

describe('incremental metadata updates', () => {
  // Applies changes to a loaded index and checks the result against a fresh build of the same files.
  async function apply(files: MemoryFiles, changes: MetadataChange[], edit: () => void) {
    const index = metadataIndex(files);
    await index.load();
    edit();
    const report = await index.update(changes);
    expect(metadataState(await index.load())).toEqual(metadataState(await metadataIndex(files).load()));
    return report;
  }

  it('does nothing before the first load', async () => {
    const files = vault();
    const index = metadataIndex(files);
    files.files.set('New.md', '[[Plan]]');
    expect(await index.update([{ path: 'New.md', operation: 'created' }])).toEqual({ changed: [], deleted: [], resolved: [] });
    expect((await index.load()).files()).toContain('New.md');
  });

  it('re-indexes a modified note and only its own resolution', async () => {
    const files = vault();
    const report = await apply(files, [{ path: 'Notes/Ideas.md', operation: 'updated' }], () => files.files.set('Notes/Ideas.md', '---\naliases: [Brainstorm]\n---\nOnly [[Missing]] now.'));
    expect(report).toEqual({ changed: ['Notes/Ideas.md'], deleted: [], resolved: ['Notes/Ideas.md'] });
  });

  it('re-resolves sources whose links a created file satisfies', async () => {
    const files = vault();
    const report = await apply(files, [{ path: 'Missing.md', operation: 'created' }], () => files.files.set('Missing.md', '# Found'));
    expect(report).toEqual({ changed: ['Missing.md'], deleted: [], resolved: ['Missing.md', 'Notes/Plan.md'] });
  });

  it('reports deleted files and the sources whose ambiguity it removed', async () => {
    const files = vault();
    const report = await apply(files, [{ path: 'B/Target.md', operation: 'deleted' }], () => files.files.delete('B/Target.md'));
    expect(report).toEqual({ changed: [], deleted: ['B/Target.md'], resolved: ['Notes/Ideas.md'] });
  });

  it('handles renames, alias changes and missing files reported as updated', async () => {
    let files = vault();
    const renamed = await apply(files, [{ path: 'Notes/Thoughts.md', oldPath: 'Notes/Ideas.md', operation: 'renamed' }], () => {
      files.files.set('Notes/Thoughts.md', files.files.get('Notes/Ideas.md')!);
      files.files.delete('Notes/Ideas.md');
    });
    expect(renamed).toEqual({ changed: ['Notes/Thoughts.md'], deleted: ['Notes/Ideas.md'], resolved: ['Notes/Plan.md', 'Notes/Thoughts.md'] });
    files = vault();
    expect(await apply(files, [{ path: 'Notes/Ideas.md', operation: 'updated' }], () => files.files.set('Notes/Ideas.md', '---\naliases: Storm\n---\n[[Plan]]')))
      .toEqual({ changed: ['Notes/Ideas.md'], deleted: [], resolved: ['Notes/Ideas.md', 'Notes/Plan.md'] });
    files = vault();
    expect(await apply(files, [{ path: 'A/Target.md', operation: 'updated' }], () => files.files.delete('A/Target.md')))
      .toEqual({ changed: [], deleted: ['A/Target.md'], resolved: ['Notes/Ideas.md'] });
  });

  it('invalidates paths by re-reading them, clearing fixed issues and ignoring hidden files', async () => {
    const files = vault();
    const index = metadataIndex(files);
    const cache = await index.load();
    files.files.set('Bad.md', '[[Plan]]');
    files.files.set('.hidden/Other.md', '[[Plan]]');
    expect(await index.invalidate(['Bad.md', '.hidden/Other.md'])).toEqual({ changed: ['Bad.md'], deleted: [], resolved: ['Bad.md'] });
    expect(cache.issues()).toEqual([]);
    expect(cache.backlinks('Notes/Plan.md').map(item => item.source)).toEqual(['Bad.md', 'Board.canvas', 'Notes/Ideas.md']);
    expect(metadataState(cache)).toEqual(metadataState(await metadataIndex(files).load()));
  });
});
