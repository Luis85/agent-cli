import { describe, expect, it } from 'vitest';
import type { NoteSource } from '../../src/plugins/backlog/domain/items.ts';
import { buildModel, displayType, inPlan, type BacklogItem, type BacklogModel } from '../../src/plugins/backlog/domain/model.ts';
import { requirementsBoard, observedStates } from '../../src/plugins/backlog/domain/board.ts';
import { checkBacklog } from '../../src/plugins/backlog/domain/check.ts';
import { dependentsClosure } from '../../src/plugins/backlog/domain/dependencies.ts';
import { resolveSettings } from '../../src/plugins/backlog/domain/settings-resolve.ts';

/** Frontmatter by path; `[[x]]` links are frontmatter links; links resolve by basename or path without `.md`. */
function vault(notes: Record<string, Record<string, unknown>>): NoteSource {
  const resolve = (linkpath: string) => Object.keys(notes).find(path => path === `${linkpath}.md` || path.slice(path.lastIndexOf('/') + 1, -3) === linkpath) ?? null;
  return {
    frontmatter: path => notes[path],
    frontmatterLinks: path => Object.entries(notes[path] ?? {}).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item, index) => [`${key}.${index}`, item] as const) : [[key, value] as const]))
      .flatMap(([key, value]) => (typeof value === 'string' && /^\[\[.+\]\]$/.test(value) ? [{ key, link: value.slice(2, -2).split('|')[0]! }] : [])),
    resolve,
  };
}
const build = (notes: Record<string, Record<string, unknown>>, results: string[], options: Record<string, unknown> = {}) =>
  buildModel(vault(notes), results, resolveSettings({ stateProperty: 'note.status', dependsOnProperty: 'note.dependsOn', ...options }), path => path in notes);

describe('the hierarchy', () => {
  const notes = {
    'Epic.md': { type: 'epic', order: 2 },
    'Feature.md': { type: 'Feature', parent: '[[Epic|The epic]]', order: 1 },
    'Story.md': { parent: 'Feature', order: 3 },
    'Bug.md': { type: 'Bug', parent: ['[[Epic]]', '[[Feature]]'] },
    'Child of bug.md': { parent: '[[Bug]]', order: 1 },
    'Lost.md': { type: 'PBI', parent: '[[Nowhere]]', order: 0 },
    'A.md': { type: 'Task', parent: '[[B]]' }, 'B.md': { type: 'Task', parent: '[[A]]' },
    'Loose.md': { title: 'not backlog work' },
    'Root.md': { parent: '' },
    'Context.md': { type: 'Epic', order: 9 },
    'Inner.md': { type: 'Feature', parent: '[[Context]]', order: 5 },
  };
  const hierarchy = () => build(notes, Object.keys(notes).filter(path => path !== 'Context.md'));

  it('links the first parent link, bare names and display-text links, cuts loops and keeps orphans as roots', () => {
    const model = hierarchy();
    expect(model.roots.map(item => item.path)).toEqual(['Lost.md', 'Epic.md', 'Context.md', 'A.md', 'Root.md']);
    expect(model.byPath.get('Feature.md')!.parent!.path).toBe('Epic.md');
    expect(model.byPath.get('Story.md')!.parent!.path).toBe('Feature.md');
    expect(model.byPath.get('Bug.md')!.parent!.path).toBe('Epic.md');
    expect(model.byPath.get('Lost.md')).toMatchObject({ orphan: true, cycleCut: false });
    expect(model.byPath.get('A.md')).toMatchObject({ orphan: true, cycleCut: true });
    expect(model.byPath.get('B.md')!.parent!.path).toBe('A.md');
    expect(model.byPath.get('Context.md')!.outsideFilter).toBe(true);
    // hierarchyOnly prunes a root subtree without parents, known types or explicit roots.
    expect(model.ignored).toEqual(['Loose.md']);
    expect(model.byPath.has('Root.md')).toBe(true);
  });

  it('sorts siblings by rank, assigns rungs, implied types and the extra-type rank', () => {
    const model = hierarchy();
    expect(model.byPath.get('Epic.md')!.children.map(item => item.title)).toEqual(['Feature', 'Bug']);
    expect(['Epic.md', 'Feature.md', 'Story.md', 'Bug.md', 'Child of bug.md'].map(path => {
      const item = model.byPath.get(path)!;
      return [displayType(item), item.levelIndex, item.effectiveLevelIndex, item.impliedType];
    })).toEqual([['Epic', 0, 0, false], ['Feature', 1, 1, false], ['PBI', 2, 2, true], ['Bug', -1, 2, false], ['Task', 3, 3, true]]);
    expect(model.ranked.map(item => item.path)).toEqual(['Lost.md', 'Feature.md', 'Child of bug.md', 'Epic.md', 'Story.md', 'Inner.md', 'Context.md', 'Bug.md', 'A.md', 'B.md', 'Root.md']);
  });

  it('keeps every unparented note with hierarchyOnly off', () => {
    expect(build(notes, Object.keys(notes), { hierarchyOnly: false }).ignored).toEqual([]);
  });

  it('infers parents from folder notes in folder mode unless the note names its own parent or is an explicit root', () => {
    const folder = { 'w/w.md': { type: 'Epic' }, 'w/f/f.md': { type: 'Feature' }, 'w/f/s.md': { type: 'PBI' }, 'w/f/r.md': { type: 'PBI', parent: '' } };
    const folders = build(folder, Object.keys(folder), { inferFolderHierarchy: true });
    expect(folders.byPath.get('w/f/s.md')!.parent!.path).toBe('w/f/f.md');
    expect(folders.byPath.get('w/f/f.md')!.parent!.path).toBe('w/w.md');
    expect(folders.byPath.get('w/f/r.md')!.parent).toBeNull();
    const named = { ...folder, 'w/f/n.md': { type: 'PBI', parent: '[[Nowhere]]' } };
    expect(build(named, Object.keys(named), { inferFolderHierarchy: true }).byPath.get('w/f/n.md')).toMatchObject({ parent: null, orphan: true });
    const flat = build(folder, Object.keys(folder));
    expect(['w/f/s.md', 'w/f/f.md'].map(path => flat.byPath.get(path)!.parent)).toEqual([null, null]);
  });
});

describe('dependencies, board and check', () => {
  const notes = {
    'a.md': { type: 'PBI', order: 1, status: 'Open', dependsOn: ['[[b]]', '[[ghost]]'] },
    'b.md': { type: 'PBI', order: 2, status: 'doing', dependsOn: '[[c]]' },
    'c.md': { type: 'PBI', order: 2, status: 'Done', dependsOn: ['[[b]]', '[[c]]'] },
    'd.md': { type: 'Deliverable', order: 4, status: 'Open', dependsOn: ['[[a]]', '[[a]]'] },
    'm.md': { type: 'Milestone', order: 5, dependsOn: ['[[a]]'], release: '[[x]]' },
    'r.md': { type: 'Release', order: 6, horizon: 'Now' },
    'u.md': { type: 'Task', status: 'Open', start: '2026-10-05', due: '2026-10-01' },
  };
  const options = { stateValues: 'Open, Doing, Done', 'wipLimit.doing': '1', releaseProperty: 'note.release', horizonProperty: 'note.horizon', startProperty: 'note.start', targetProperty: 'note.due' };
  const planned = () => build(notes, Object.keys(notes), options);

  it('marks self references, loops (Tarjan) and unresolved entries broken, and keeps markers out', () => {
    const model = planned();
    const of = (path: string) => model.byPath.get(path)!;
    expect(of('a.md').prerequisites.map(item => item.path)).toEqual(['b.md']);
    expect(of('a.md').brokenPrerequisites).toEqual([{ raw: '[[ghost]]', reason: 'unresolved' }]);
    expect(of('b.md').brokenPrerequisites).toEqual([{ raw: '[[c]]', reason: 'cycle' }]);
    expect(of('c.md').brokenPrerequisites).toEqual([{ raw: '[[b]]', reason: 'cycle' }, { raw: '[[c]]', reason: 'cycle' }]);
    expect(of('d.md').prerequisites.map(item => item.path)).toEqual(['a.md']);
    expect(of('m.md').prerequisites).toEqual([]);
    expect([...dependentsClosure('b.md', new Map([['a.md', ['b.md']], ['d.md', ['a.md']]]))]).toEqual(['b.md', 'a.md', 'd.md']);
  });

  it('builds board columns from stateValues with WIP limits, a no-state column and stray observed states', () => {
    const model = planned();
    expect(observedStates(model.results, resolveSettings({ stateProperty: 'note.status' }))).toEqual(['doing', 'Open', 'Done']);
    const columns = requirementsBoard(model, resolveSettings({ stateProperty: 'note.status', ...options }));
    expect(columns.map(column => [column.state, column.cards.map(card => card.title), column.limit, column.held])).toEqual([
      [null, ['m'], null, 1], ['Open', ['a', 'u'], null, 2], ['Doing', ['b'], 1, 1], ['Done', ['c'], null, 1],
    ]);
  });

  it('reports cycles, broken links, fields a type may not hold, unreadable spans and rank problems', () => {
    const model = planned();
    const settings = resolveSettings({ stateProperty: 'note.status', dependsOnProperty: 'note.dependsOn', ...options });
    const problems = checkBacklog({ model, settings, releaseProblems: [], unresolvedMemberships: ['m.md'], typeOf: () => null });
    expect(problems.map(problem => [problem.code, problem.path ?? problem.paths?.join(',')])).toEqual([
      ['unresolved-dependency', 'a.md'], ['dependency-cycle', 'b.md'], ['dependency-cycle', 'c.md'], ['dependency-cycle', 'c.md'],
      ['field-not-held', 'm.md'], ['field-not-held', 'r.md'], ['reversed-span', 'u.md'], ['unresolved-membership', 'm.md'],
      ['rank-tie', 'b.md,c.md'], ['unranked', 'u.md'],
    ]);
    expect(problems.find(problem => problem.code === 'unranked')?.message).toBe('1 item has no rank and sorts last; run backlog ranks seed.');
  });
});

describe('model rules', () => {
  const pick = <K extends keyof BacklogItem>(model: BacklogModel, keys: K[]) =>
    Object.fromEntries(model.items.map(item => [item.title, Object.fromEntries(keys.map(key => [key, item[key]]))]));

  it('orders siblings by rank, then entry order, with unranked notes last, at every depth', () => {
    const notes = {
      'Late.md': { type: 'Epic' }, 'Three.md': { type: 'Epic', order: 3 }, 'OneA.md': { type: 'Epic', order: 1 }, 'Early.md': { type: 'Epic' }, 'OneB.md': { type: 'Epic', order: 1 },
      'c.md': { type: 'Feature', parent: '[[Three]]', order: 9 }, 'a.md': { type: 'Feature', parent: '[[Three]]', order: -2 }, 'b.md': { type: 'Feature', parent: '[[Three]]' },
    };
    const model = build(notes, Object.keys(notes));
    expect(model.roots.map(item => item.title)).toEqual(['OneA', 'OneB', 'Three', 'Late', 'Early']);
    expect(model.byPath.get('Three.md')!.children.map(item => item.title)).toEqual(['a', 'c', 'b']);
    expect(model.items.map(item => item.title)).toEqual(['OneA', 'OneB', 'Three', 'a', 'c', 'b', 'Late', 'Early']);
    expect(model.items.map(item => item.depth)).toEqual([0, 0, 0, 1, 1, 1, 0, 0]);
    expect(model.ranked.map(item => item.title)).toEqual(['a', 'OneA', 'OneB', 'Three', 'c', 'Late', 'Early', 'b']);
  });

  it('rolls up descendants, skipping markers, context rows and test-catalog items, and marks finished subtrees', () => {
    const notes = {
      'E.md': { type: 'Epic', status: 'Done' }, 'F.md': { type: 'Feature', parent: '[[E]]', status: 'done' },
      'S1.md': { type: 'PBI', parent: '[[F]]', status: 'Done' }, 'S2.md': { type: 'PBI', parent: '[[F]]', status: 'Open' },
      'M.md': { type: 'Milestone', parent: '[[E]]', status: 'Done' }, 'T.md': { type: 'Test case', parent: '[[E]]', status: 'Open' },
      'G.md': { type: 'Epic', status: 'Done' }, 'G1.md': { type: 'Feature', parent: '[[G]]', status: 'Done' },
      'Z.md': { type: 'Epic' }, 'Y.md': { type: 'Feature', parent: '[[Z]]', status: 'Done' }, 'X.md': { type: 'PBI', parent: '[[Y]]', status: 'Done' },
      'Suite.md': { type: 'Test suite', status: 'Done' }, 'Case.md': { type: 'Test case', parent: '[[Suite]]', status: 'Open' },
    };
    const model = build(notes, Object.keys(notes).filter(path => path !== 'Y.md'));
    expect(pick(model, ['descendantCount', 'doneDescendants', 'subtreeDone', 'done'])).toEqual({
      E: { descendantCount: 3, doneDescendants: 2, subtreeDone: false, done: true },
      F: { descendantCount: 2, doneDescendants: 1, subtreeDone: false, done: true },
      S1: { descendantCount: 0, doneDescendants: 0, subtreeDone: true, done: true },
      S2: { descendantCount: 0, doneDescendants: 0, subtreeDone: false, done: false },
      M: { descendantCount: 0, doneDescendants: 0, subtreeDone: true, done: true },
      T: { descendantCount: 0, doneDescendants: 0, subtreeDone: false, done: false },
      G: { descendantCount: 1, doneDescendants: 1, subtreeDone: true, done: true },
      G1: { descendantCount: 0, doneDescendants: 0, subtreeDone: true, done: true },
      Z: { descendantCount: 1, doneDescendants: 1, subtreeDone: false, done: false },
      Y: { descendantCount: 1, doneDescendants: 1, subtreeDone: true, done: true },
      X: { descendantCount: 0, doneDescendants: 0, subtreeDone: true, done: true },
      Suite: { descendantCount: 0, doneDescendants: 0, subtreeDone: true, done: true },
      Case: { descendantCount: 0, doneDescendants: 0, subtreeDone: false, done: false },
    });
  });

  it('lists plan results, iterations and releases among the notes the filter returned', () => {
    const notes = {
      'E.md': { type: 'Epic' }, 'P.md': { type: 'PBI', parent: '[[E]]' }, 'R.md': { type: 'release' }, 'I.md': { type: 'ITERATION' }, 'M.md': { type: 'Milestone' },
      'Suite.md': { type: 'Test suite' }, 'Case.md': { type: 'Test case', parent: '[[Suite]]' }, 'Step.md': { type: 'Task', parent: '[[Case]]' },
      'Ctx.md': { type: 'Release' }, 'Under.md': { type: 'PBI', parent: '[[Ctx]]' },
    };
    const model = build(notes, Object.keys(notes).filter(path => path !== 'Ctx.md'));
    expect(model.results.map(item => item.title)).toEqual(['E', 'P', 'M', 'Under']);
    expect(model.iterations.map(item => item.title)).toEqual(['I']);
    expect(model.releases.map(item => item.title)).toEqual(['R']);
    expect(model.byPath.get('Step.md')).toMatchObject({ ladder: ['Test suite', 'Test case', 'Task'], levelIndex: 2 });
    expect([inPlan({ ladder: [], typeName: 'PBI' }), inPlan({ ladder: [], typeName: 'Release' }), inPlan({ ladder: [], typeName: 'iteration' }), inPlan({ ladder: [], typeName: null })])
      .toEqual([true, false, false, true]);
  });

  it('prunes roots without a parent link, a known type, an explicit root or a member below them', () => {
    const notes = {
      'Loose.md': { title: 'x' }, 'Odd.md': { type: 'Spike' }, 'Known.md': { type: 'bug' }, 'Holder.md': {}, 'Kid.md': { type: 'Spike', parent: '[[Holder]]' },
      'Gone.md': { parent: '[[Nowhere]]' }, 'Blank.md': { parent: '' }, 'Late.md': { type: 'Spike' },
    };
    const model = build(notes, Object.keys(notes));
    expect(model.ignored).toEqual(['Loose.md', 'Odd.md', 'Late.md']);
    expect(model.roots.map(item => item.title)).toEqual(['Known', 'Holder', 'Gone', 'Blank']);
    expect(model.items.map(item => item.title)).toEqual(['Known', 'Holder', 'Kid', 'Gone', 'Blank']);
    expect([...model.byPath.keys()].sort()).toEqual(['Blank.md', 'Gone.md', 'Holder.md', 'Kid.md', 'Known.md']);
    expect(model.byPath.get('Gone.md')).toMatchObject({ orphan: true, cycleCut: false });
    expect(model.byPath.get('Blank.md')).toMatchObject({ orphan: false, cycleCut: false });
    expect(model.byPath.get('Holder.md')).toMatchObject({ orphan: false, cycleCut: false, prerequisites: [], brokenPrerequisites: [] });
  });

  it('cuts a parent loop at the note that closes it and keeps the rest of the loop below it', () => {
    const notes = {
      'A.md': { type: 'Epic', parent: '[[C]]' }, 'B.md': { type: 'Feature', parent: '[[A]]' }, 'C.md': { type: 'PBI', parent: '[[B]]' },
      'D.md': { type: 'Task', parent: '[[B]]' }, 'Self.md': { type: 'Epic', parent: '[[Self]]' }, 'Top.md': { type: 'Epic' },
    };
    const model = build(notes, Object.keys(notes));
    expect(model.roots.map(item => item.title)).toEqual(['A', 'Self', 'Top']);
    expect(model.items.map(item => [item.title, item.parent?.title ?? null, item.depth])).toEqual([
      ['A', null, 0], ['B', 'A', 1], ['C', 'B', 2], ['D', 'B', 2], ['Self', null, 0], ['Top', null, 0],
    ]);
    expect(pick(model, ['orphan', 'cycleCut'])).toEqual({
      Self: { orphan: true, cycleCut: false }, Top: { orphan: false, cycleCut: false }, A: { orphan: true, cycleCut: true },
      B: { orphan: false, cycleCut: false }, C: { orphan: false, cycleCut: false }, D: { orphan: false, cycleCut: false },
    });
    expect(model.byPath.get('C.md')!.children).toEqual([]);
  });

  it('assigns rungs by type case-insensitively, below the parent for unknown and untyped notes, clamped at the deepest rung', () => {
    const notes = {
      'Root.md': { type: 'EPIC' }, 'Sub.md': { type: 'epic', parent: '[[Root]]' }, 'Spike.md': { type: 'Spike', parent: '[[Root]]' },
      'Bare.md': { type: 'Spike' }, 'Bug.md': { type: 'Bug' }, 'T.md': { type: 'Task', parent: '[[Spike]]' }, 'Deep.md': { parent: '[[T]]' },
      'Untyped.md': { parent: '' }, 'Suite.md': { type: 'test SUITE' }, 'Case.md': { parent: '[[Suite]]' },
    };
    const model = build(notes, Object.keys(notes), { hierarchyOnly: false });
    expect(model.items.map(item => [item.title, displayType(item), item.levelIndex, item.effectiveLevelIndex, item.impliedType])).toEqual([
      ['Root', 'Epic', 0, 0, false], ['Sub', 'Epic', 0, 0, false], ['Spike', 'Spike', -1, 1, false], ['T', 'Task', 3, 3, false], ['Deep', 'Task', 3, 3, true],
      ['Bare', 'Spike', -1, 0, false], ['Bug', 'Bug', -1, 2, false], ['Untyped', 'Epic', 0, 0, true], ['Suite', 'Test suite', 0, 0, false], ['Case', 'Test case', 1, 1, true],
    ]);
    expect(displayType({ levelIndex: -1, ladder: [], typeName: null })).toBe('');
  });
});
