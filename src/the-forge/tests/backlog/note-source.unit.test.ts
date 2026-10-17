import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { noteSource } from '../support/backlog.ts';
import { MemoryFiles, metadataIndex } from '../support/metadata.ts';

/** The shared backlog `NoteSource` fake agrees with the metadata cache the backlog session reads in the CLI. */
it('derives frontmatter links and resolves link paths like the metadata cache', async () => {
  const notes: Record<string, Record<string, unknown>> = {
    'plan/Item.md': { parent: '[[Epic|the epic]]', dependsOn: ['[[A#Part]]', '[[Missing]]', 'plain text'], nested: { release: '[[plan/1.0]]' }, other: '[x](B.md)' },
    'plan/Epic.md': { type: 'Epic' },
    'plan/A.md': {}, 'other/A.md': {}, 'B.md': {}, 'plan/1.0.md': { type: 'Release' }, 'Board.canvas': {},
  };
  const cache = await metadataIndex(new MemoryFiles(Object.fromEntries(Object.entries(notes).map(([path, frontmatter]) => [
    path, path.endsWith('.md') ? `---\n${stringify(frontmatter)}---\n` : '{"nodes":[],"edges":[]}',
  ])))).load();
  const fake = noteSource(notes);
  for (const path of Object.keys(notes).filter(path => path.endsWith('.md'))) {
    expect(fake.frontmatterLinks(path), path).toEqual((cache.getFileCache(path)?.frontmatterLinks ?? []).map(({ key, link }) => ({ key, link })));
  }
  expect(fake.frontmatterLinks('plan/Item.md').map(link => link.key)).toEqual(['parent', 'dependsOn.0', 'dependsOn.1', 'nested.release', 'other']);
  for (const linkpath of ['Epic', 'A', 'B', 'B.md', 'plan/1.0', 'Missing', 'Board', 'Board.canvas', 'epic']) {
    for (const source of ['plan/Item.md', 'other/A.md', 'B.md']) {
      expect(fake.resolve(linkpath, source), `${linkpath} from ${source}`).toBe(cache.getClosestLinkpathDest(linkpath, source));
    }
  }
  // An ambiguous name opens the closest file, as the session's resolution does.
  expect(fake.resolve('A', 'plan/Item.md')).toBe('plan/A.md');
  expect(fake.resolve('A', 'other/A.md')).toBe('other/A.md');
});
