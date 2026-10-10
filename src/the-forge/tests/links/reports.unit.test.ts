import { describe, expect, it } from 'vitest';
import { deadendNotes, linksBack, linksOut, orphanNotes, unresolvedLinks } from '../../src/plugins/links/application/links.ts';
import { pathGlob } from '../../src/domain/documents/path-glob.ts';
import { MemoryFiles, metadataIndex } from '../support/metadata.ts';

const vault = {
  'Home.md': '# Home\n\nStart at [[Projects/Alpha|Alpha]] and ![[assets/logo.png]].\n',
  'Projects/Alpha.md': '---\nrelated: "[[Beta]]"\n---\nSee [[Missing note]] and [beta](Beta.md) and [[Home#Top]].\n',
  'Projects/Beta.md': 'Ambiguous [[Shared]] and https://example.com and [[#Local]].\n',
  'Archive/Shared.md': 'Old.\n',
  'Drafts/Shared.md': 'New.\n',
  'Board.canvas': JSON.stringify({ nodes: [{ id: 'n1', type: 'file', file: 'Projects/Alpha.md', x: 0, y: 0, width: 1, height: 1 }, { id: 'n2', type: 'file', file: 'Gone.md', x: 0, y: 0, width: 1, height: 1 }], edges: [] }),
  'Broken.md': '---\ninvalid: [\n---\n[[Home]]\n',
  'assets/logo.png': 'png',
  '.obsidian/app.json': '{}',
};
const load = () => metadataIndex(new MemoryFiles(vault)).load();
const all = () => true;

describe('link reports over the metadata cache', () => {
  it('lists a note\'s outgoing references with 1-based locations, keys and resolutions', async () => {
    const { path, links, issues } = linksOut(await load(), 'Projects/Alpha.md');
    expect(path).toBe('Projects/Alpha.md');
    expect(issues).toEqual([]);
    expect(links).toEqual([
      { source: path, kind: 'link', line: 4, column: 5, offset: 32, original: '[[Missing note]]', link: 'Missing note', displayText: 'Missing note', status: 'unresolved', reason: 'missing' },
      { source: path, kind: 'link', line: 4, column: 26, offset: 53, original: '[beta](Beta.md)', link: 'Beta.md', displayText: 'beta', status: 'resolved', target: 'Projects/Beta.md', via: 'path' },
      { source: path, kind: 'link', line: 4, column: 46, offset: 73, original: '[[Home#Top]]', link: 'Home#Top', displayText: 'Home > Top', status: 'resolved', target: 'Home.md', via: 'path' },
      { source: path, kind: 'frontmatter', key: 'related', original: '[[Beta]]', link: 'Beta', displayText: 'Beta', status: 'resolved', target: 'Projects/Beta.md', via: 'path' },
    ]);
  });

  it('lists backlinks from other files, including embeds, frontmatter and Canvas file nodes', async () => {
    const { backlinks } = linksBack(await load(), 'Projects/Alpha.md');
    expect(backlinks.map(entry => [entry.source, entry.kind, entry.original])).toEqual([
      ['Board.canvas', 'canvas', 'Projects/Alpha.md'],
      ['Home.md', 'link', '[[Projects/Alpha|Alpha]]'],
    ]);
    expect(backlinks[0]).toMatchObject({ node: 'n1', status: 'resolved', target: 'Projects/Alpha.md' });
    expect(linksBack(await load(), 'assets/logo.png').backlinks).toEqual([expect.objectContaining({ source: 'Home.md', kind: 'embed', line: 3 })]);
  });

  it('reports every unresolved reference with its reason and ambiguity candidates, filtered by source path', async () => {
    const { links, issues } = unresolvedLinks(await load(), all);
    expect(links.map(entry => [entry.source, entry.original, entry.reason, entry.candidates])).toEqual([
      ['Board.canvas', 'Gone.md', 'missing', undefined],
      ['Projects/Alpha.md', '[[Missing note]]', 'missing', undefined],
      ['Projects/Beta.md', '[[Shared]]', 'ambiguous', ['Archive/Shared.md', 'Drafts/Shared.md']],
    ]);
    expect(issues).toEqual([expect.objectContaining({ path: 'Broken.md', code: 'INVALID_YAML' })]);
    expect(unresolvedLinks(await load(), pathGlob('Projects/**')).links).toHaveLength(2);
  });

  it('finds orphans except configured roots, and dead ends without links to other files', async () => {
    const cache = await load();
    expect(orphanNotes(cache, all, () => false).files).toEqual(['Archive/Shared.md', 'Board.canvas', 'Broken.md', 'Drafts/Shared.md']);
    expect(orphanNotes(cache, all, pathGlob('{Board.canvas,Broken.md}')).files).toEqual(['Archive/Shared.md', 'Drafts/Shared.md']);
    expect(orphanNotes(cache, pathGlob('Archive/**'), () => false).files).toEqual(['Archive/Shared.md']);
    // Beta links only to itself (#Local), an external URL and an ambiguous target, which still counts as a link.
    expect(deadendNotes(cache, all).files).toEqual(['Archive/Shared.md', 'Drafts/Shared.md']);
  });

  it('rejects notes that are missing, hidden or outside the vault', async () => {
    const cache = await load();
    for (const note of ['Nope.md', '.obsidian/app.json']) expect(() => linksOut(cache, note)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => linksBack(cache, '../outside.md')).toThrow(expect.objectContaining({ code: expect.stringMatching(/INVALID_PATH|UNSAFE_PATH/) }));
    expect(linksOut(cache, 'Broken.md')).toEqual({ path: 'Broken.md', links: [], issues: [expect.objectContaining({ path: 'Broken.md' })] });
  });
});
