import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileToLinktext, joinPath, linkIndex, resolveLinkpath, type LinkResolution } from '../../src/domain/metadata/link-resolution.ts';

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
const expected = (resolve: () => string | null) => {
  try { return resolve(); } catch (error) { return (error as Error).message; }
};
const outcome = (result: LinkResolution) => {
  if (result.status === 'resolved') return result.path;
  return result.status === 'unresolved' && result.reason === 'ambiguous' ? `AMBIGUOUS ${result.candidates.join(', ')}` : null;
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
const sources = ['Notes/Today.md', 'Projects/Board.md', 'Root.md', 'Archive/Notes/Log.md'];

describe('indexed link resolution', () => {
  it('matches a direct scan of every path for wiki and relative Markdown targets from several folders', () => {
    const index = linkIndex(paths);
    for (const source of sources) {
      for (const target of targets) {
        for (const relative of [false, true]) {
          expect(outcome(resolveLinkpath(index, target, source, { relative })), `${target} from ${source}${relative ? ' (relative)' : ''}`)
            .toEqual(expected(() => scan(target, source, paths, relative)));
        }
      }
    }
  });

  it('reports every ambiguous candidate in vault path order with the normalized link path', () => {
    expect(resolveLinkpath(linkIndex(paths), 'plan#Heading', 'Root.md')).toEqual({
      status: 'unresolved', reason: 'ambiguous', via: 'path', linkpath: 'plan', candidates: ['Archive/Notes/Plan.md', 'Archive/plan.md', 'Notes/Plan.md', 'Notes/Sub/Plan.md'],
    });
    expect(resolveLinkpath(linkIndex(paths), '/Notes/IDEAS', 'Root.md')).toMatchObject({ linkpath: 'Notes/IDEAS', candidates: ['Notes/Ideas.md', 'Notes/ideas', 'Notes/IDEAS.MD'] });
    expect(resolveLinkpath(linkIndex(paths), 'Missing#Part', 'Root.md')).toEqual({ status: 'unresolved', reason: 'missing', linkpath: 'Missing' });
    expect(resolveLinkpath(linkIndex(paths), 'mailto:someone@example.com', 'Root.md')).toEqual({ status: 'external' });
  });

  it('joins and normalizes relative targets exactly like posix paths', () => {
    for (const folder of ['.', 'Notes', 'Notes/Sub', 'a/b/c']) {
      for (const target of ['x', '../x', '../../x', '../../../../x', './x', 'x/', 'x//y', '.', '..', '../', 'a/./b/../c', '', '../../..']) {
        expect(joinPath(folder, target), `${target} from ${folder}`).toBe(posix.normalize(posix.join(folder, target)));
      }
    }
  });
});

describe('alias resolution', () => {
  const index = linkIndex(['Notes/Plan.md', 'Notes/Roadmap.md', 'People/Ada.md', 'People/Grace.md'], new Map([
    ['Notes/Roadmap.md', ['Plan', 'Q4 goals']], ['People/Ada.md', ['Countess', 'AL']], ['People/Grace.md', ['al']],
  ]));

  it('resolves wikilink text to a note alias case-insensitively after path matching fails', () => {
    expect(resolveLinkpath(index, 'q4 GOALS#Scope', 'Root.md', { aliases: true })).toEqual({ status: 'resolved', path: 'Notes/Roadmap.md', via: 'alias' });
    expect(resolveLinkpath(index, 'Plan', 'Root.md', { aliases: true })).toEqual({ status: 'resolved', path: 'Notes/Plan.md', via: 'path' });
    expect(resolveLinkpath(index, 'Q4 goals', 'Root.md')).toEqual({ status: 'unresolved', reason: 'missing', linkpath: 'Q4 goals' });
    expect(resolveLinkpath(index, 'Q4 goals', 'Root.md', { aliases: true, relative: true })).toMatchObject({ reason: 'missing' });
  });

  it('records a shared alias as ambiguous instead of choosing a note', () => {
    expect(resolveLinkpath(index, 'Al', 'Root.md', { aliases: true })).toEqual({
      status: 'unresolved', reason: 'ambiguous', via: 'alias', linkpath: 'Al', candidates: ['People/Ada.md', 'People/Grace.md'],
    });
  });
});

describe('shortest link text', () => {
  const index = linkIndex(paths);

  it('uses the file name when it resolves back from the source and the full path otherwise', () => {
    expect(fileToLinktext(index, 'Projects/Ünïcode.md', 'Root.md')).toBe('Ünïcode');
    expect(fileToLinktext(index, 'Notes/Plan.md', 'Root.md')).toBe('Notes/Plan');
    expect(fileToLinktext(index, 'Notes/Plan.md', 'Notes/Today.md')).toBe('Plan');
    expect(fileToLinktext(index, 'Notes/ideas', 'Root.md')).toBe('Notes/ideas');
    expect(fileToLinktext(index, 'Assets/image.png', 'Root.md')).toBe('Assets/image.png');
    expect(fileToLinktext(index, 'Notes/IDEAS.MD', 'Root.md')).toBe('Notes/IDEAS.MD');
    expect(fileToLinktext(index, 'README.md', 'Notes/Today.md', false)).toBe('README.md');
  });

  it('always produces link text that resolves to the file from every source', () => {
    for (const path of paths) {
      for (const source of sources) {
        expect(resolveLinkpath(index, fileToLinktext(index, path, source), source), `${path} from ${source}`).toMatchObject({ status: 'resolved', path });
      }
    }
  });
});
