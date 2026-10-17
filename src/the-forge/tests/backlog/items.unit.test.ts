import { describe, expect, it } from 'vitest';
import { createItems, nearestFolderNote, type FrontmatterLink, type NoteSource } from '../../src/plugins/backlog/domain/items.ts';
import { resolveSettings } from '../../src/plugins/backlog/domain/settings-resolve.ts';
import { noteSource } from '../support/backlog.ts';

/**
 * A vault whose metadata cache records exactly the given frontmatter links (as Obsidian does, the link without its
 * display text), so a test can tell a cached link from the raw frontmatter text. Every linkpath resolves to a note
 * of that basename when one exists.
 */
const items = (source: NoteSource, results: string[], options: Record<string, unknown> = {}, exists?: (path: string) => boolean) => {
  const settings = resolveSettings({ dependsOnProperty: 'note.dependsOn', releaseProperty: 'note.release', ...options });
  return createItems(source, results, settings, exists ?? (path => source.frontmatter(path) !== undefined));
};
const parentOf = (source: NoteSource, path: string) => {
  const item = items(source, [path]).byPath.get(path)!;
  return [item.parentPath, item.hasParentValue, item.explicitRoot];
};

describe('parent links', () => {
  it.each([
    ['no cache entry', undefined, [], [null, false, false]],
    ['no parent key', {}, [], [null, false, false]],
    ['a bare name', { parent: 'P' }, [], ['P.md', true, false]],
    ['a wikilink with a heading and display text', { parent: '[[P#Scope|the parent]]' }, [], ['P.md', true, false]],
    ['a list, reading its first entry', { parent: ['P', 'Q'] }, [], ['P.md', true, false]],
    ['an unresolved name', { parent: 'Nowhere' }, [], [null, true, false]],
    ['a link to a heading only', { parent: '[[#Scope]]' }, [], [null, true, false]],
    ['an empty value, an explicit root', { parent: '' }, [], [null, false, true]],
    ['a blank value, an explicit root', { parent: '   ' }, [], [null, false, true]],
    ['a number, an explicit root', { parent: 5 }, [], [null, false, true]],
    ['an empty list, an explicit root', { parent: [] }, [], [null, false, true]],
    ['a cached link, preferred over the text', { parent: 'Q' }, [{ key: 'parent', link: 'P#Scope' }], ['P.md', true, false]],
    ['a cached link of a later list entry', { parent: ['', '[[P]]'] }, [{ key: 'parent.1', link: 'P' }], ['P.md', true, false]],
    ['a cached link of another key', { parent: 'Q' }, [{ key: 'parents', link: 'P' }, { key: 'grandparent.0', link: 'P' }], ['Q.md', true, false]],
  ])('reads %s', (_, frontmatter, links, expected) => {
    const source = noteSource({ 'n/Item.md': frontmatter, 'P.md': {}, 'Q.md': {} }, { 'n/Item.md': links });
    expect(parentOf(source, 'n/Item.md')).toEqual(expected);
  });
});

describe('link lists', () => {
  const dependsOn = (frontmatter: Record<string, unknown> | undefined, links: FrontmatterLink[] = [], options: Record<string, unknown> = {}) =>
    items(noteSource({ 'n/Item.md': frontmatter, 'A.md': {}, 'B.md': {} }, { 'n/Item.md': links }), ['n/Item.md'], options).byPath.get('n/Item.md')!.dependsOnEntries;

  it('reads text entries, trimmed, resolved by their linkpath, and skips other values', () => {
    expect(dependsOn({ dependsOn: [' [[A|first]] ', 'B#Notes', '', '   ', 7, null, '[[#Here]]', 'Ghost'] })).toEqual([
      { raw: '[[A|first]]', path: 'A.md' }, { raw: 'B#Notes', path: 'B.md' }, { raw: '[[#Here]]', path: null }, { raw: 'Ghost', path: null },
    ]);
    expect(dependsOn({ dependsOn: 'A' })).toEqual([{ raw: 'A', path: 'A.md' }]);
    expect(dependsOn({})).toEqual([]);
    expect(dependsOn(undefined)).toEqual([]);
    expect(dependsOn({ dependsOn: 'A' }, [], { dependsOnProperty: '' })).toEqual([]);
  });

  it('prefers the cached link of each entry, by its list index, over the text', () => {
    const links = [{ key: 'dependsOn.1', link: 'A#Part' }, { key: 'dependsOnOther.0', link: 'B' }, { key: 'dependsOn', link: 'B' }];
    expect(dependsOn({ dependsOn: ['Ghost', 'Spook'] }, links)).toEqual([{ raw: 'Ghost', path: null }, { raw: 'Spook', path: 'A.md' }]);
    expect(dependsOn({ dependsOn: 'Spook' }, links)).toEqual([{ raw: 'Spook', path: 'B.md' }]);
  });

  it('never resolves an empty linkpath', () => {
    const source: NoteSource = { frontmatter: () => ({ dependsOn: ['#Here', '[[A]]'] }), frontmatterLinks: () => [], resolve: linkpath => `${linkpath}.md` };
    const settings = resolveSettings({ dependsOnProperty: 'note.dependsOn' });
    expect(createItems(source, ['Item.md'], settings, () => true).byPath.get('Item.md')!.dependsOnEntries).toEqual([{ raw: '#Here', path: null }, { raw: '[[A]]', path: 'A.md' }]);
  });
});

describe('item fields', () => {
  it('reads titles, ids, ranks and release membership', () => {
    const notes = {
      'n/x.mdx.md': { 'pbl-id': 4.7, order: '2.5', release: ['[[A]]', '[[B]]'] }, 'n/Upper.MD': { 'pbl-id': '12', release: ['[[A]]'] },
      'n/None.md': { 'pbl-id': 'n/a', release: '[[A]]' }, 'A.md': {}, 'B.md': {},
    };
    const store = items(noteSource(notes), ['n/x.mdx.md', 'n/Upper.MD', 'n/None.md']);
    expect(store.all.map(item => [item.title, item.pblId, item.order, item.releaseEntry?.path ?? null, item.releaseMultiple, item.entryIndex])).toEqual([
      ['x.mdx', 4, 2.5, 'A.md', true, 0], ['Upper', 12, null, 'A.md', false, 1], ['None', null, null, 'A.md', false, 2],
    ]);
  });

  it('sets resources and absences aside, in result order, and skips them as context ancestors', () => {
    const notes = {
      'p/Ada.md': { type: 'resource' }, 'a/Leave.md': { type: 'Absence' }, 'p/Bob.md': { type: 'Resource' }, 'a/Trip.md': { type: 'absence' },
      'n/Task.md': { type: 'Task', parent: '[[Carl]]' }, 'p/Carl.md': { type: 'Resource' }, 'n/Gap.md': { type: 'Task', parent: '[[Away]]' }, 'a/Away.md': { type: 'Absence' },
    };
    const store = items(noteSource(notes), ['p/Ada.md', 'a/Leave.md', 'p/Bob.md', 'a/Trip.md', 'n/Task.md', 'n/Gap.md']);
    expect(store.resources).toEqual(['p/Ada.md', 'p/Bob.md']);
    expect(store.absences).toEqual(['a/Leave.md', 'a/Trip.md']);
    expect(store.all.map(item => item.path)).toEqual(['n/Task.md', 'n/Gap.md']);
  });

  it('reads Markdown results once, then their ancestors outside the filter as context, unless showOutsideParents is off', () => {
    const notes = { 'c.md': { parent: '[[b]]' }, 'b.md': { parent: '[[a]]' }, 'a.md': { parent: '[[Board.canvas]]' }, 'Board.canvas': {}, 'x.base': {} };
    const store = items(noteSource(notes), ['c.md', 'c.md', 'x.base', 'C.MD']);
    expect(store.all.map(item => [item.path, item.outsideFilter, item.parentExists])).toEqual([
      ['c.md', false, true], ['C.MD', false, false], ['b.md', true, true], ['a.md', true, true],
    ]);
    expect(items(noteSource(notes), ['c.md'], { showOutsideParents: false }).all.map(item => item.path)).toEqual(['c.md']);
    expect(items(noteSource(notes), ['c.md'], {}, path => path === 'b.md').all.map(item => item.path)).toEqual(['c.md', 'b.md']);
  });

  it('seeds folder notes as parents in folder mode unless the note names a parent or is an explicit root', () => {
    const notes = {
      'w/w.md': { type: 'Epic' }, 'w/f/f.md': { type: 'Feature' }, 'w/f/s.md': { type: 'PBI' }, 'w/f/named.md': { parent: '[[Nowhere]]' }, 'w/f/root.md': { parent: '' },
    };
    const folders = items(noteSource(notes), ['w/f/s.md', 'w/f/named.md', 'w/f/root.md'], { inferFolderHierarchy: true });
    expect(folders.all.map(item => [item.path, item.outsideFilter, item.parentExists])).toEqual([
      ['w/f/s.md', false, true], ['w/f/named.md', false, false], ['w/f/root.md', false, false], ['w/f/f.md', true, true], ['w/w.md', true, false],
    ]);
    expect(items(noteSource(notes), ['w/f/s.md']).all.map(item => [item.path, item.parentExists])).toEqual([['w/f/s.md', false]]);
  });

  it('finds the nearest folder note above a note, skipping the note\'s own folder note', () => {
    const exists = (path: string) => ['w/w.md', 'w/f/f.md', 'w/f/g/g.md'].includes(path);
    expect(nearestFolderNote('w/f/s.md', exists)).toBe('w/f/f.md');
    expect(nearestFolderNote('w/f/f.md', exists)).toBe('w/w.md');
    expect(nearestFolderNote('w/f/g/h/i.md', exists)).toBe('w/f/g/g.md');
    expect(nearestFolderNote('w/w.md', exists)).toBeNull();
    expect(nearestFolderNote('top.md', exists)).toBeNull();
    expect(nearestFolderNote('x/y/z.md', exists)).toBeNull();
  });
});

describe('bound properties', () => {
  it('never resolves a parent that names only a heading', () => {
    const source: NoteSource = { frontmatter: () => ({ parent: '#Here' }), frontmatterLinks: () => [], resolve: linkpath => `${linkpath}.md` };
    const item = createItems(source, ['Item.md'], resolveSettings({}), () => true).byPath.get('Item.md')!;
    expect([item.parentPath, item.hasParentValue, item.explicitRoot]).toStrictEqual([null, true, false]);
  });

  it('resolves a cached link by its trimmed linkpath', () => {
    const source = noteSource({ 'n/Item.md': { dependsOn: ['[[A #Part]]', '[[B | alias]]'] }, 'A.md': {}, 'B.md': {} }, { 'n/Item.md': [{ key: 'dependsOn.0', link: 'A #Part' }, { key: 'dependsOn.1', link: 'B | alias' }] });
    expect(items(source, ['n/Item.md']).byPath.get('n/Item.md')!.dependsOnEntries).toStrictEqual([{ raw: '[[A #Part]]', path: 'A.md' }, { raw: '[[B | alias]]', path: 'B.md' }]);
  });

  it('reads the first assignee and iteration link, labels, workflow states and tags of bound keys only', () => {
    const notes = {
      'n/Item.md': {
        type: 'Deliverable', assignee: ['[[Ada]]', '[[Bob]]'], iteration: '[[Sprint]]', risk: '1 - High', priority: ['2 - Should'], goal: 'Ship', status: 'Done', built: 'Final', verdict: 'Passed', tags: '#a b',
      },
      'Ada.md': {}, 'Bob.md': {}, 'Sprint.md': {},
    };
    const bound = {
      assigneeProperty: 'note.assignee', iterationProperty: 'note.iteration', riskProperty: 'note.risk', priorityProperty: 'note.priority', iterationGoalProperty: 'note.goal',
      stateProperty: 'note.status', deliverableStateProperty: 'note.built', deliverableDoneValues: 'Final', testStateProperty: 'note.verdict', testDoneValues: 'Passed',
    };
    const read = (options: Record<string, unknown>) => {
      const item = items(noteSource(notes), ['n/Item.md'], options).byPath.get('n/Item.md')!;
      return [item.assigneeEntry, item.iterationEntry, item.riskValue, item.priorityValue, item.iterationGoalValue, item.stateValue, item.done,
        item.deliverableStateValue, item.deliverableDone, item.testStateValue, item.testDone, item.tags];
    };
    expect(read(bound)).toStrictEqual([{ raw: '[[Ada]]', path: 'Ada.md' }, { raw: '[[Sprint]]', path: 'Sprint.md' }, '1 - High', '2 - Should', 'Ship', 'Done', true, 'Final', true, 'Passed', true, ['a', 'b']]);
    expect(read({ tagsProperty: '' })).toStrictEqual([null, null, null, null, null, null, false, null, false, null, false, []]);
    expect(read({ assigneeProperty: 'note.missing', iterationProperty: 'note.missing' }).slice(0, 2)).toStrictEqual([null, null]);
  });
});
