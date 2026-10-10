import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseLinkIndex, resolveBaseLink } from '../../src/infrastructure/bases/links.ts';

// Reference rules as a direct scan over every path: exact spelling, then one case-insensitive match,
// then (for wiki-style targets) one case-insensitive `/`-suffix match.
function scan(target: string, source: string, paths: readonly string[], relative = false): string | null {
  target = target.split('#')[0] ?? '';
  if (!target) return source;
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(target)) return null;
  target = target.replace(/^\//, '');
  const local = posix.normalize(posix.join(posix.dirname(source), target));
  const candidates = relative ? [local, target] : [target, local];
  for (const candidate of candidates) {
    for (const spelling of [candidate, `${candidate}.md`]) if (paths.includes(spelling)) return spelling;
  }
  for (const candidate of candidates) {
    const found = paths.filter(path => [candidate, `${candidate}.md`].some(spelling => path.toLowerCase() === spelling.toLowerCase()));
    if (found.length === 1) return found[0]!;
    if (found.length > 1) throw new Error(`AMBIGUOUS ${found.join(', ')}`);
  }
  if (relative || target.startsWith('../')) return null;
  const matches = paths.filter(path => [target, `${target}.md`].some(spelling => path.toLowerCase().endsWith('/' + spelling.toLowerCase())));
  if (matches.length > 1) throw new Error(`AMBIGUOUS ${matches.join(', ')}`);
  return matches[0] ?? null;
}
const outcome = (resolve: () => string | null) => {
  try { return resolve(); } catch (error) { return `AMBIGUOUS ${(error as Error).message.split(': ').pop()?.replace(/^AMBIGUOUS /, '')}`; }
};

const paths = [
  'Archive/Notes/Plan.md', 'Archive/plan.md', 'Notes/Plan.md', 'Notes/Sub/Plan.md', 'Notes/Ideas.md', 'Notes/ideas', 'Notes/IDEAS.MD',
  'Projects/Alpha.md', 'Projects/alpha.md.md', 'Projects/Ünïcode.md', 'Projects/ΟΔΟΣ.md', 'Assets/image.png', 'Assets/IMAGE.PNG', 'README.md', 'ideas.md',
];
const targets = [
  'Plan', 'plan', 'Notes/Plan', 'notes/plan.md', 'Sub/Plan', 'Archive/Notes/Plan', 'Ideas', 'ideas', 'IDEAS', 'Notes/ideas', 'notes/ideas',
  'Alpha', 'alpha.md', 'ALPHA.MD', 'Projects/alpha', 'ünïcode', 'ΟΔΟΣ', 'οδος', 'Οδοσ', 'image.png', 'IMAGE.png', 'Assets/image.PNG', 'readme',
  '../README', '../Projects/Alpha', 'Projects/Alpha#Heading', '#Self', '/Notes/Plan', 'Missing', 'https://example.com/Plan', '', 'Sub', 'otes/Plan',
];

describe('indexed Bases link resolution', () => {
  it('matches a direct scan of every path for wiki and relative Markdown targets from several folders', () => {
    const index = baseLinkIndex(paths);
    for (const source of ['Notes/Today.md', 'Projects/Board.md', 'Root.md', 'Archive/Notes/Log.md']) {
      for (const target of targets) {
        for (const relative of [false, true]) {
          expect(outcome(() => resolveBaseLink(target, source, index, relative)), `${target} from ${source}${relative ? ' (relative)' : ''}`)
            .toEqual(outcome(() => scan(target, source, paths, relative)));
        }
      }
    }
  });

  it('reports every ambiguous candidate in vault path order', () => {
    expect(() => resolveBaseLink('plan', 'Root.md', baseLinkIndex(paths))).toThrow(expect.objectContaining({
      code: 'AMBIGUOUS_BASE_LINK', message: 'Link plan in Root.md matches multiple files: Archive/Notes/Plan.md, Archive/plan.md, Notes/Plan.md, Notes/Sub/Plan.md',
    }));
    expect(() => resolveBaseLink('Notes/IDEAS', 'Root.md', baseLinkIndex(paths))).toThrow(expect.objectContaining({
      code: 'AMBIGUOUS_BASE_LINK', message: 'Link Notes/IDEAS in Root.md matches multiple files: Notes/Ideas.md, Notes/ideas, Notes/IDEAS.MD',
    }));
  });
});
