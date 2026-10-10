import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  baseFileContent, basePath, iterationNoteName, newItemFrontmatter, nextItemId, nextIterationDates, nextIterationName, noteText, previousIteration, releaseFrontmatter, sanitizeTitle, uniqueNotePath,
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
  });

  it('numbers collisions and spells paths the vault way', () => {
    const taken = new Set(['docs/Plan.md', 'docs/Plan 1.md']);
    expect(uniqueNotePath('docs', 'Plan', path => taken.has(path))).toBe('docs/Plan 2.md');
    expect(uniqueNotePath('', 'Plan', () => false)).toBe('Plan.md');
    expect(uniqueNotePath('docs//req/', 'Plan', () => false)).toBe('docs/req/Plan.md');
    expect(basePath(' ', () => false)).toEqual({ folder: 'docs', path: 'docs/Product Backlog.base' });
    expect(basePath('work/', path => path === 'work/Product Backlog.base')).toEqual({ folder: 'work', path: 'work/Product Backlog 1.base' });
  });

  it('takes the next pbl-id over numeric ids and numeric strings only', () => {
    expect(nextItemId([])).toBe(1);
    expect(nextItemId([{ 'pbl-id': 7 }, { 'pbl-id': '12' }, { 'pbl-id': '13x' }, { 'pbl-id': 2.9 }, undefined, { other: 99 }, { 'pbl-id': [40] }])).toBe(13);
  });
});

describe('new note frontmatter', () => {
  const settings = resolveSettings({ iterationProperty: 'note.iteration', releaseProperty: 'note.release', iterationGoalProperty: 'note.goal', horizonProperty: 'note.horizon', startProperty: 'note.start', targetProperty: 'note.due' });
  it('writes the plugin\'s key order and only frontmatter', () => {
    const frontmatter = newItemFrontmatter(settings, {
      id: 4, typeName: 'PBI', order: 7.03125, parentLink: '[[Route sharing]]', iterationLink: '[[1 - Iteration]]', releaseLink: '[[1.0]]', iterationGoal: 'ignored on purpose',
      axis: { horizon: 'Now', start: '2026-10-01', target: '2026-10-14' },
    });
    expect(Object.keys(frontmatter)).toEqual(['pbl-id', 'type', 'parent', 'order', 'goal', 'iteration', 'release', 'horizon', 'start', 'due']);
    expect(noteText(stringify(frontmatter))).toBe('---\npbl-id: 4\ntype: PBI\nparent: "[[Route sharing]]"\norder: 7.03125\ngoal: ignored on purpose\niteration: "[[1 - Iteration]]"\nrelease: "[[1.0]]"\nhorizon: Now\nstart: 2026-10-01\ndue: 2026-10-14\n---\n');
    expect(Object.keys(newItemFrontmatter(resolveSettings({ inferFolderHierarchy: true }), { id: 1, typeName: 'Epic', order: 1000, parentLink: null }))).toEqual(['pbl-id', 'type', 'parent', 'order']);
    expect(Object.keys(newItemFrontmatter(settings, { id: 1, typeName: 'Epic', order: 1000, parentLink: null }))).toEqual(['pbl-id', 'type', 'order']);
    // A release is never seeded with an iteration, release or planning axis.
    expect(newItemFrontmatter(settings, { id: 2, typeName: 'Release', order: 5, parentLink: null, iterationLink: '[[x]]', axis: { start: '2026-01-01' } })).toEqual({ 'pbl-id': 2, type: 'Release', order: 5 });
  });

  it('writes releases with only the bound and stated keys', () => {
    const release = resolveReleaseSettings({ versionProperty: 'note.version', targetDateProperty: 'note.target-date', releaseStatusProperty: 'note.status' });
    expect(releaseFrontmatter(release, 9, { version: '1.2.0', targetDate: '2026-12-01', status: ' ', description: 'not bound' })).toEqual({ 'pbl-id': 9, type: 'Release', version: '1.2.0', 'target-date': '2026-12-01' });
  });

  it('scaffolds the plugin\'s base file', () => {
    expect(baseFileContent('docs')).toBe('filters:\n  and:\n    - "file.inFolder(\\"docs\\")"\n    - file.ext == "md"\nviews:\n  - type: product-backlog\n    name: Backlog\n    homeFolder: "docs"\n');
    expect(baseFileContent('a"b')).toContain('- "file.inFolder(\\"a\\\\\\"b\\")"');
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
