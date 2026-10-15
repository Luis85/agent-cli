import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  baseFileContent, basePath, comments, iterationNoteName, newItemFrontmatter, nextItemId, nextIterationDates, nextIterationName, noteBody, noteText, previousIteration, releaseFrontmatter,
  sanitizeTitle, uniqueNotePath, withBody, withoutComments,
} from '../../src/plugins/backlog/domain/notes.ts';
import { resolveReleaseSettings, resolveSettings } from '../../src/plugins/backlog/domain/settings-resolve.ts';
import {
  canonicalType, childLevelIndex, drawsAsPoint, keepsProjection, ladderFor, mayHoldField, placementEnds, LEVELS, TEST_LEVELS,
} from '../../src/plugins/backlog/domain/vocabulary.ts';

describe('note names', () => {
  it('sanitizes titles like the plugin', () => {
    expect(sanitizeTitle('Route: sharing / export?')).toBe('Route- sharing - export');
    expect(sanitizeTitle('  [[Wiki]] #tag ^block | "quoted" <x> *y*  ')).toBe('Wiki-- -tag -block - -quoted- -x- -y');
    expect(sanitizeTitle('...hidden.  ')).toBe('hidden.');
    expect(sanitizeTitle('a\t\nb')).toBe('a b');
    expect(sanitizeTitle('///')).toBe('Untitled');
    expect(sanitizeTitle('')).toBe('Untitled');
    expect(sanitizeTitle('Plan --  ')).toBe('Plan');
  });

  it('numbers collisions and spells paths the vault way', () => {
    const taken = new Set(['docs/Plan.md', 'docs/Plan 1.md']);
    expect(uniqueNotePath('docs', 'Plan', path => taken.has(path))).toBe('docs/Plan 2.md');
    expect(uniqueNotePath('', 'Plan', () => false)).toBe('Plan.md');
    expect(uniqueNotePath('docs//req/', 'Plan', () => false)).toBe('docs/req/Plan.md');
    expect(basePath(' ', () => false)).toEqual({ folder: 'docs', path: 'docs/Product Backlog.base' });
    expect(basePath('work/', path => path === 'work/Product Backlog.base')).toEqual({ folder: 'work', path: 'work/Product Backlog 1.base' });
    expect(basePath('work', path => path !== 'work/Product Backlog 2.base')).toEqual({ folder: 'work', path: 'work/Product Backlog 2.base' });
  });

  it('takes the next pbl-id over numeric ids and numeric strings only', () => {
    expect(nextItemId([])).toBe(1);
    expect(nextItemId([{ 'pbl-id': 7 }, { 'pbl-id': '12' }, { 'pbl-id': '13x' }, { 'pbl-id': 2.9 }, undefined, { other: 99 }, { 'pbl-id': [40] }])).toBe(13);
    expect(nextItemId([{ 'pbl-id': 20 }, { 'pbl-id': '12' }])).toBe(21);
  });

  it.each([
    ['the largest safe integer', Number.MAX_SAFE_INTEGER],
    ['beyond the safe range', 2 ** 53],
    ['an unsafe numeric string', '9007199254740993'],
  ])('ignores unsafe ids: %s', (_, id) => {
    expect(nextItemId([{ 'pbl-id': id }, { 'pbl-id': 4 }])).toBe(5);
  });
});

describe('new note frontmatter', () => {
  const settings = () => resolveSettings({ iterationProperty: 'note.iteration', releaseProperty: 'note.release', iterationGoalProperty: 'note.goal', horizonProperty: 'note.horizon', startProperty: 'note.start', targetProperty: 'note.due' });
  it('writes the plugin\'s key order and only frontmatter', () => {
    const frontmatter = newItemFrontmatter(settings(), {
      id: 4, typeName: 'PBI', order: 7.03125, parentLink: '[[Route sharing]]', iterationLink: '[[1 - Iteration]]', releaseLink: '[[1.0]]', iterationGoal: 'ignored on purpose',
      axis: { horizon: 'Now', start: '2026-10-01', target: '2026-10-14' },
    });
    expect(Object.keys(frontmatter)).toEqual(['pbl-id', 'type', 'parent', 'order', 'goal', 'iteration', 'release', 'horizon', 'start', 'due']);
    expect(noteText(stringify(frontmatter))).toBe('---\npbl-id: 4\ntype: PBI\nparent: "[[Route sharing]]"\norder: 7.03125\ngoal: ignored on purpose\niteration: "[[1 - Iteration]]"\nrelease: "[[1.0]]"\nhorizon: Now\nstart: 2026-10-01\ndue: 2026-10-14\n---\n');
    expect(Object.keys(newItemFrontmatter(resolveSettings({ inferFolderHierarchy: true }), { id: 1, typeName: 'Epic', order: 1000, parentLink: null }))).toEqual(['pbl-id', 'type', 'parent', 'order']);
    expect(Object.keys(newItemFrontmatter(settings(), { id: 1, typeName: 'Epic', order: 1000, parentLink: null }))).toEqual(['pbl-id', 'type', 'order']);
    // A release is never seeded with an iteration, release or planning axis.
    expect(newItemFrontmatter(settings(), { id: 2, typeName: 'Release', order: 5, parentLink: null, iterationLink: '[[x]]', axis: { start: '2026-01-01' } })).toEqual({ 'pbl-id': 2, type: 'Release', order: 5 });
  });

  it('writes an empty parent for a folder-hierarchy root and no key for an unbound axis', () => {
    expect(newItemFrontmatter(resolveSettings({ inferFolderHierarchy: true }), { id: 1, typeName: 'Epic', order: 1000, parentLink: null })).toStrictEqual({ 'pbl-id': 1, type: 'Epic', parent: '', order: 1000 });
    const unbound = newItemFrontmatter(resolveSettings({ startProperty: 'note.start' }), { id: 2, typeName: 'PBI', order: 1, parentLink: null, axis: { horizon: 'Now', start: '2026-10-01' } });
    expect(unbound).toStrictEqual({ 'pbl-id': 2, type: 'PBI', order: 1, start: '2026-10-01' });
  });

  it('writes releases with only the bound and stated keys', () => {
    const release = resolveReleaseSettings({ versionProperty: 'note.version', targetDateProperty: 'note.target-date', releaseStatusProperty: 'note.status' });
    expect(releaseFrontmatter(release, 9, { version: '1.2.0', targetDate: '2026-12-01', status: ' ', description: 'not bound' })).toEqual({ 'pbl-id': 9, type: 'Release', version: '1.2.0', 'target-date': '2026-12-01' });
    expect(releaseFrontmatter(release, 3, {})).toStrictEqual({ 'pbl-id': 3, type: 'Release' });
  });

  it('scaffolds the plugin\'s base file', () => {
    expect(baseFileContent('docs')).toBe('filters:\n  and:\n    - "file.inFolder(\\"docs\\")"\n    - file.ext == "md"\nviews:\n  - type: product-backlog\n    name: Backlog\n    homeFolder: "docs"\n');
    expect(baseFileContent('a"b')).toContain('- "file.inFolder(\\"a\\\\\\"b\\")"');
    const backslash = baseFileContent('a\\b');
    expect(backslash).toContain(String.raw`- "file.inFolder(\"a\\\\b\")"`);
    expect(backslash).toContain(String.raw`homeFolder: "a\\b"`);
  });
});

describe('note bodies after the frontmatter', () => {
  it.each([
    ['blank lines after the frontmatter', '---\na: 1\n---\n\n\nbody\n\nmore', 'body\n\nmore'],
    ['an empty frontmatter', '---\n---\n\n\na\n\nb', 'a\n\nb'],
    ['a byte order mark', '\uFEFF---\na: 1\n---\nbody', 'body'],
    ['CRLF line endings', '---\r\na: 1\r\n---\r\n\r\nbody', 'body'],
    ['delimiters with trailing spaces', '---  \na: 1\n--- \t\nbody', 'body'],
    ['a frontmatter closed at the end of the file', '---\na: 1\n---', ''],
    ['dashes inside a value do not close', '---\na: x---\nb: 2\n---\nbody', 'body'],
    ['no frontmatter', 'Intro\n---\nx\n---\nbody', 'Intro\n---\nx\n---\nbody'],
    ['an opening line with text after the dashes', '---x\na: 1\n---\nbody', '---x\na: 1\n---\nbody'],
    ['an unterminated frontmatter', '---\na: 1\nbody', '---\na: 1\nbody'],
    ['leading blank lines without frontmatter', '\n\nbody', 'body'],
  ])('reads the body: %s', (_, text, body) => {
    expect(noteBody(text)).toBe(body);
  });

  it.each([
    ['a note without frontmatter', 'old', 'new', 'new\n'],
    ['line endings normalized', 'old', ' a\r\nb\rc ', 'a\nb\nc\n'],
    ['a frontmatter closed at the end of the file', '---\na: 1\n---', 'body', '---\na: 1\n---\nbody\n'],
    ['a frontmatter ending in a newline', '---\na: 1\n---\nold', 'body', '---\na: 1\n---\nbody\n'],
    ['a blank body keeps only the frontmatter', '---\na: 1\n---\nold', ' \n ', '---\na: 1\n---\n'],
    ['a blank body without frontmatter', 'old', '', ''],
  ])('replaces the body: %s', (_, text, body, result) => {
    expect(withBody(text, body)).toBe(result);
  });
});

describe('iterations', () => {
  const iteration = (title: string, start: [number, number, number] | null, target: [number, number, number] | null, outsideFilter = false) => ({
    title, path: `it/${title}.md`, typeName: 'Iteration', outsideFilter,
    plannedStart: { value: start && { year: start[0], month: start[1], day: start[2] } }, plannedTarget: { value: target && { year: target[0], month: target[1], day: target[2] } },
  });
  it('names, dates and orders iterations like the plugin dialog', () => {
    const items = [iteration('1 - Iteration', [2026, 9, 1], [2026, 9, 14]), iteration('2 - Iteration - Ship it', [2026, 9, 15], [2026, 9, 28]), iteration('9 - Old', null, null, true)];
    expect(nextIterationName(items)).toBe('3 - Iteration');
    expect(iterationNoteName('3 - Iteration', '  Share a route  ')).toBe('3 - Iteration - Share a route');
    expect(iterationNoteName('3 - Iteration', 'x'.repeat(70))).toBe(`3 - Iteration - ${'x'.repeat(60)}`);
    expect(previousIteration(items)?.title).toBe('2 - Iteration - Ship it');
    expect(nextIterationDates(previousIteration(items), { year: 2026, month: 1, day: 1 }, 14)).toEqual({ start: '2026-09-29', target: '2026-10-12' });
    expect(nextIterationDates(null, { year: 2026, month: 2, day: 20 }, 14)).toEqual({ start: '2026-02-20', target: '2026-03-05' });
  });

  it.each([
    ['only a leading number counts', ['Sprint 7', 'Sprint7'], '1 - Iteration'],
    ['multi-digit numbers', [' 12 - Iteration'], '13 - Iteration'],
    ['titles without a number are skipped', ['Kickoff', '4 - Iteration'], '5 - Iteration'],
    ['the highest number, not the last', ['2 - Iteration', '1 - Iteration'], '3 - Iteration'],
  ])('names the next iteration: %s', (_, titles, name) => {
    expect(nextIterationName(titles.map(title => iteration(title, null, null)))).toBe(name);
  });

  it('adds no goal suffix for a blank goal', () => {
    expect(iterationNoteName('3 - Iteration', '   ')).toBe('3 - Iteration');
  });

  it.each([
    // Each winner is named 'a' when a rule must beat the path order, and 'b' when the path decides.
    ['the latest target', [iteration('a', [2026, 9, 1], [2026, 9, 28]), iteration('b', [2026, 9, 10], [2026, 9, 14])], 'a'],
    ['then the latest start', [iteration('a', [2026, 9, 5], [2026, 9, 14]), iteration('b', [2026, 9, 1], [2026, 9, 14])], 'a'],
    ['a dated start before a missing one', [iteration('a', [2026, 9, 1], [2026, 9, 14]), iteration('b', null, [2026, 9, 14])], 'a'],
    ['then the greater path without starts', [iteration('b', null, [2026, 9, 14]), iteration('a', null, [2026, 9, 14])], 'b'],
    ['then the greater path with equal starts', [iteration('b', [2026, 9, 1], [2026, 9, 14]), iteration('a', [2026, 9, 1], [2026, 9, 14])], 'b'],
    ['skipping undated iterations and other types', [iteration('b', null, [2026, 9, 14]), iteration('z', null, null), { ...iteration('y', null, [2026, 12, 1]), typeName: 'Task' }], 'b'],
  ])('picks the previous iteration by %s in any order', (_, items, title) => {
    expect(previousIteration(items)?.title).toBe(title);
    expect(previousIteration([...items].reverse())?.title).toBe(title);
  });
});

describe('Obsidian comments around code', () => {
  // [case, body, body without comments, comments found]
  it.each([
    ['an empty body', '', '', []],
    ['an inline comment', 'a %%x%% b %%y%%', 'a  b ', ['%%x%%', '%%y%%']],
    ['a multi-line comment', 'a\n%%\nb\n%%\nc', 'a\n\nc', ['%%\nb\n%%']],
    ['a comment inside a backtick fence', '```\n%%k%%\n```\nafter %%c%%', '```\n%%k%%\n```\nafter ', ['%%c%%']],
    ['a comment inside a tilde fence', 'x\n~~~\n%%k%%\n~~~\n', 'x\n~~~\n%%k%%\n~~~\n', []],
    ['an empty block before a comment', '```\n```\n%%secret%%\n```js\ncode\n```\n', '```\n```\n\n```js\ncode\n```\n', ['%%secret%%']],
    ['an empty block before code holding %%', '```\n```\n%%secret%%\n```js\ncode %%x%%\n```\n', '```\n```\n\n```js\ncode %%x%%\n```\n', ['%%secret%%']],
    ['a fence indented by two spaces', '  ```\n%%keep%%\n  ```\n', '  ```\n%%keep%%\n  ```\n', []],
    ['a fence indented by three spaces', '   ~~~\n%%k%%\n~~~\n%%c%%', '   ~~~\n%%k%%\n~~~\n', ['%%c%%']],
    ['four spaces of indentation are not a fence', '    ```\n%%x%%\n', '    ```\n\n', ['%%x%%']],
    ['a tab is not fence indentation', '\t~~~\n%%x%%\n', '\t~~~\n\n', ['%%x%%']],
    ['one or two tildes are not a fence', '~\n%%x%%\n~~\n%%y%%', '~\n\n~~\n', ['%%x%%', '%%y%%']],
    ['the other fence character does not close', '```\n~~~\n%%k%%\n```\n%%c%%', '```\n~~~\n%%k%%\n```\n', ['%%c%%']],
    ['backticks do not close a tilde fence', '~~~\n```\n%%k%%\n~~~\n%%c%%', '~~~\n```\n%%k%%\n~~~\n', ['%%c%%']],
    ['a shorter run does not close', '````\n```\n%%k%%\n````\n%%c%%', '````\n```\n%%k%%\n````\n', ['%%c%%']],
    ['a longer run closes', '```\n%%k%%\n`````\n%%c%%', '```\n%%k%%\n`````\n', ['%%c%%']],
    ['a line with an info string does not close', '```\n```js\n%%k%%\n```\n%%c%%', '```\n```js\n%%k%%\n```\n', ['%%c%%']],
    ['a closer with trailing spaces closes', '```\n%%k%%\n```  \n%%c%%', '```\n%%k%%\n```  \n', ['%%c%%']],
    ['a closer indented by three spaces closes', '```\n%%k%%\n   ```\n%%c%%', '```\n%%k%%\n   ```\n', ['%%c%%']],
    ['a closer indented by four spaces is code', '```\n    ```\n%%k%%\n```\n%%c%%', '```\n    ```\n%%k%%\n```\n', ['%%c%%']],
    ['an unclosed fence runs to the end', 'a %%c%%\n```\n%%k%%', 'a \n```\n%%k%%', ['%%c%%']],
    ['a backtick info string cannot hold a backtick', '```a`b\n%%c%%\n```\n%%k%%', '```a`b\n\n```\n%%k%%', ['%%c%%']],
    ['a tilde info string may hold backticks', '~~~ a`b\n%%k%%\n~~~\n%%c%%', '~~~ a`b\n%%k%%\n~~~\n', ['%%c%%']],
    ['CRLF line endings', '```\r\n%%k%%\r\n```\r\n%%c%%', '```\r\n%%k%%\r\n```\r\n', ['%%c%%']],
    ['backticks inside a line are not a fence', 'Use ``` and %%c%%\n%%d%%', 'Use ``` and \n', ['%%c%%', '%%d%%']],
  ])('keeps fenced code: %s', (_, body, without, found) => {
    expect(withoutComments(body)).toBe(without);
    expect(comments(body)).toEqual(found);
  });

  it.each([
    ['a comment inside inline code', 'use `%%x%%` here', 'use `%%x%%` here', []],
    ['an opener shown as code before a comment', 'Type `%%` to open. Later %%secret%% end', 'Type `%%` to open. Later  end', ['%%secret%%']],
    ['a double-backtick span holding a backtick', 'a ``x`%%y%%`` %%c%%', 'a ``x`%%y%%`` ', ['%%c%%']],
    ['a span closes only at a run of equal length', 'a ``x` %%c%%', 'a ``x` ', ['%%c%%']],
    ['an unmatched backtick protects nothing', 'it`s %%c%%', 'it`s ', ['%%c%%']],
    ['a span continuing on the next line', 'a `b\n%%k%%` c', 'a `b\n%%k%%` c', []],
    ['a blank line ends a span', 'a `b\n\n%%c%%\n\nd `e', 'a `b\n\n\n\nd `e', ['%%c%%']],
    ['a whitespace-only line ends a span', 'a `b\n \t\n%%c%% `', 'a `b\n \t\n `', ['%%c%%']],
    ['a comment opened first wins over code', '%%a `b%% c`', ' c`', ['%%a `b%%']],
  ])('keeps inline code: %s', (_, body, without, found) => {
    expect(withoutComments(body)).toBe(without);
    expect(comments(body)).toEqual(found);
  });
});

describe('type vocabulary', () => {
  it('matches types case-insensitively and writes canonical spelling', () => {
    expect(canonicalType('pbi')).toBe('PBI');
    expect(canonicalType('TEST SUITE')).toBe('Test suite');
    expect(canonicalType('Spike')).toBe('Spike');
  });

  it('climbs the plan and test ladders and clamps the deepest rung', () => {
    expect(ladderFor('Test case', null)).toBe(TEST_LEVELS);
    expect(ladderFor('Task', TEST_LEVELS)).toBe(TEST_LEVELS);
    expect(ladderFor('task', null)).toBe(LEVELS);
    expect(ladderFor(null, null)).toBe(LEVELS);
    const task = { levelIndex: 3, effectiveLevelIndex: 3, ladder: LEVELS, typeName: 'Task' };
    expect(childLevelIndex(task)).toBe(3);
    expect(childLevelIndex(null)).toBe(0);
    expect(keepsProjection({ typeName: 'Test case', ladder: TEST_LEVELS }, { ladder: LEVELS })).toBe(true);
    expect(keepsProjection({ typeName: 'Task', ladder: TEST_LEVELS }, { ladder: LEVELS })).toBe(false);
  });

  it('decides which fields a type may hold', () => {
    expect(mayHoldField('Milestone', 'release', false)).toBe(false);
    expect(mayHoldField('Test case', 'release', false)).toBe(false);
    expect(mayHoldField('Task', 'release', false)).toBe(true);
    for (const field of ['horizon', 'iteration', 'iterationGoal', 'start', 'target'] as const) expect(mayHoldField('release', field, true)).toBe(false);
    expect(mayHoldField('Release', 'release', false)).toBe(false);
    expect(placementEnds('Milestone', true)).toEqual(['target']);
    expect(placementEnds('Iteration', false)).toEqual(['target']);
    expect(placementEnds('Iteration', true)).toEqual(['start', 'target']);
    expect(placementEnds('Release', true)).toEqual([]);
    expect(drawsAsPoint('Epic', false)).toBe(false);
  });
});
