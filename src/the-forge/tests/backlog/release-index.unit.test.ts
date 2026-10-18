import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/plugins/backlog/domain/model.ts';
import { membershipTarget, releaseIndex, scopeRows, type ReleaseRow } from '../../src/plugins/backlog/domain/releases.ts';
import { resolveReleaseSettings, resolveSettings, type ViewOptions } from '../../src/plugins/backlog/domain/settings-resolve.ts';
import { noteSource } from '../support/backlog.ts';

/** An in-memory vault: frontmatter by path, wikilinks resolved by basename. */
const today = { year: 2026, month: 10, day: 5 };
const releaseOptions = {
  membershipProperty: 'note.release', versionProperty: 'note.version', targetDateProperty: 'note.target', releasedDateProperty: 'note.released',
  releaseStatusProperty: 'note.status', descriptionProperty: 'note.description',
};
function index(notes: Record<string, Record<string, unknown>>, plan: ViewOptions = { stateProperty: 'note.status' }, release: ViewOptions = releaseOptions, results = Object.keys(notes)) {
  const source = noteSource(notes), settings = resolveSettings({ releaseProperty: 'note.release', ...plan });
  return releaseIndex(source, buildModel(source, results, settings, path => path in notes), resolveReleaseSettings(release), settings, today);
}
const figure = (value: unknown, invalid = false) => ({ value, invalid, unconfigured: false });
const unconfigured = { value: null, invalid: false, unconfigured: true };
const date = (year: number, month: number, day: number) => ({ year, month, day });

describe('release index rows', () => {
  const notes = {
    'r/A.md': { type: 'Release', order: 2, target: '2026-11-01', version: '1.0', status: 'Open', description: ['x', 'y'] },
    'r/B.md': { type: 'Release', order: 1, target: '2026-11-01', version: 3, status: '', description: null },
    'r/C.md': { type: 'Release', target: '2026-09-01' },
    'r/D.md': { type: 'Release', order: 5 }, 'r/E.md': { type: 'Release', order: 5 },
    'r/S1.md': { type: 'Release', target: '2026-08-01', released: '2026-08-10' }, 'r/S2.md': { type: 'Release', released: '2026-09-20' },
    'r/S3.md': { type: 'Release', target: '2026-10-05', released: ['2026-09-01'] }, 'r/F.md': { type: 'Release', target: '2026-10-04' },
    'w/P1.md': { type: 'PBI', status: 'Done', release: '[[A]]' }, 'w/P2.md': { type: 'PBI', status: 'Open', release: ['[[A]]'] },
    'w/Doc.md': { type: 'Deliverable', status: 'done', release: '[[B]]' }, 'w/Ctx.md': { type: 'PBI', status: 'Done', release: '[[C]]' },
  };

  it('orders open releases by target date, then shipped ones by release date, ties by rank and path', () => {
    const { rows } = index(notes, undefined, undefined, Object.keys(notes).filter(path => path !== 'w/Ctx.md'));
    expect(rows.map(row => [row.name, row.shipped, row.overdue, row.daysToTarget, row.slip])).toEqual([
      ['C', false, true, -34, null], ['F', false, true, -1, null], ['S3', false, false, 0, null], ['B', false, false, 27, null], ['A', false, false, 27, null],
      ['D', false, false, null, null], ['E', false, false, null, null], ['S2', true, false, null, null], ['S1', true, false, -65, 9],
    ]);
    const ties = {
      'r/Z1.md': { type: 'Release', target: '2025-12-30', released: '2026-01-02' }, 'r/Y.md': { type: 'Release', target: '2027-01-15', order: 3 },
      'r/Z3.md': { type: 'Release', released: '2026-03-01' }, 'r/W1.md': { type: 'Release', target: '2027-01-15' }, 'r/X.md': { type: 'Release', target: '2026-12-01' },
      'r/W3.md': { type: 'Release', target: '2027-01-15', order: 3 }, 'r/Z2.md': { type: 'Release', released: '2026-03-01' }, 'r/W2.md': { type: 'Release', target: '2027-01-15', order: 2 },
    };
    expect(index(ties).rows.map(row => row.name)).toEqual(['X', 'W2', 'W3', 'Y', 'W1', 'Z2', 'Z3', 'Z1']);
  });

  it('reads labels, dates, member and done counts as figures', () => {
    const rows = new Map(index(notes).rows.map(row => [row.name, row]));
    const of = (name: string, keys: (keyof ReleaseRow)[]) => Object.fromEntries(keys.map(key => [key, rows.get(name)![key]]));
    expect(of('A', ['version', 'status', 'description', 'target', 'released', 'members', 'done'])).toEqual({
      version: figure('1.0'), status: figure('Open'), description: figure(null, true), target: figure(date(2026, 11, 1)), released: figure(null), members: figure(2), done: figure(1),
    });
    expect(of('B', ['version', 'status', 'description', 'members', 'done'])).toEqual({ version: figure('3'), status: figure(null, true), description: figure(null), members: figure(1), done: figure(1) });
    expect(of('C', ['version', 'members', 'done'])).toEqual({ version: figure(null), members: figure(1), done: figure(1) });
    expect(of('S3', ['released', 'shipped'])).toEqual({ released: figure(null, true), shipped: false });
    expect(of('D', ['members', 'done'])).toEqual({ members: figure(0), done: figure(0) });
  });

  it('leaves figures unconfigured for unbound properties, and done counts without a clearing workflow', () => {
    const bare = index(notes, { stateProperty: 'note.status' }, { membershipProperty: '' }).rows.find(row => row.name === 'A')!;
    expect([bare.version, bare.target, bare.status, bare.description, bare.released, bare.members, bare.done]).toEqual(Array(7).fill(unconfigured));
    const stateless = new Map(index(notes, {}).rows.map(row => [row.name, row]));
    expect([stateless.get('A')!.members, stateless.get('A')!.done, stateless.get('D')!.done]).toEqual([figure(2), unconfigured, unconfigured]);
    // Every member's own workflow must clear: requirements items do not without a state key, Deliverables do with their own.
    const mixed = { ...notes, 'w/Doc2.md': { type: 'Deliverable', dstate: 'Done', release: '[[A]]' } };
    const own = new Map(index(mixed, { deliverableStateProperty: 'note.dstate' }).rows.map(row => [row.name, row]));
    expect([own.get('A')!.done, own.get('B')!.done, own.get('D')!.done]).toEqual([unconfigured, figure(0), unconfigured]);
  });

  it('counts requirements members done by the requirements done values while the test workflow has its own key', () => {
    const shipped = { 'r/R.md': { type: 'Release' }, 'w/P.md': { type: 'PBI', status: 'Shipped', release: '[[R]]' } };
    expect(index(shipped, { stateProperty: 'note.status', doneValues: 'Shipped', testStateProperty: 'note.tstate' }).rows[0]!.done).toEqual(figure(1));
  });

  it('breaks a target tie by rank, wherever the releases sit in the tree', () => {
    const tree = {
      'w/Epic.md': { type: 'Epic', order: 5 }, 'r/Late.md': { type: 'Release', order: 1, parent: '[[Epic]]', target: '2026-12-01' }, 'r/Early.md': { type: 'Release', order: 2, target: '2026-12-01' },
    };
    expect(index(tree).rows.map(row => row.name)).toEqual(['Late', 'Early']);
  });

  it('collects unresolved memberships among the notes the filter returned', () => {
    const extra = { ...notes, 'w/Two.md': { type: 'PBI', release: ['[[A]]', '[[B]]'] }, 'w/Ghost.md': { type: 'PBI', release: '[[Nowhere]]' }, 'w/Out.md': { type: 'Epic' }, 'w/In.md': { type: 'PBI', parent: '[[Out]]', release: '[[A]]' } };
    const outside = { ...extra, 'w/Out.md': { type: 'Epic', release: '[[Nowhere]]' } };
    expect(index(outside, undefined, undefined, Object.keys(outside).filter(path => path !== 'w/Out.md')).unresolved.map(item => item.title)).toEqual(['Two', 'Ghost']);
  });
});

describe('release membership', () => {
  const notes = {
    'r/A.md': { type: 'Release' }, 'r/B.md': { type: 'Release' }, 'w/Epic.md': { type: 'Epic' },
    'w/One.md': { type: 'PBI', release: ['[[A]]'] }, 'w/Two.md': { type: 'PBI', release: ['[[A]]', '[[B]]'] }, 'w/Empty.md': { type: 'PBI', release: [] },
    'w/Null.md': { type: 'PBI', release: null }, 'w/None.md': { type: 'PBI' }, 'w/Blank.md': { type: 'PBI', release: '  ' }, 'w/Number.md': { type: 'PBI', release: 5 },
    'w/ListNumber.md': { type: 'PBI', release: [5] }, 'w/Plain.md': { type: 'PBI', release: 'B' }, 'w/Epic link.md': { type: 'PBI', release: '[[Epic]]' },
    'w/Ghost.md': { type: 'PBI', release: '[[Gone]]' }, 'm/Gate.md': { type: 'Milestone', release: '[[A]]' }, 'i/Sprint.md': { type: 'Iteration', release: '[[A]]' },
    'r/Nested.md': { type: 'Release', release: '[[A]]' }, 't/Suite.md': { type: 'Test suite', release: '[[A]]' },
    // A number never names a release, even one whose name it spells.
    'r/2.md': { type: 'Release' }, 'w/Numbered.md': { type: 'PBI', release: 2 },
  };

  it('names the one Release an item links, null without a link, and unresolved otherwise', () => {
    const source = noteSource(notes), settings = resolveSettings({});
    const model = buildModel(source, Object.keys(notes), settings, path => path in notes);
    const releases = new Set(model.releases.map(item => item.path));
    const target = (options: ViewOptions) => Object.fromEntries(model.items.filter(item => item.path.startsWith('w/') || item.path.startsWith('m/') || item.path.startsWith('i/') || item.path === 'r/Nested.md' || item.path === 't/Suite.md')
      .map(item => [item.title, membershipTarget(source, item, releases, resolveReleaseSettings(options))]));
    expect(target({ membershipProperty: 'note.release' })).toEqual({
      Epic: null, One: 'r/A.md', Two: 'unresolved', Empty: null, Null: null, None: null, Blank: 'unresolved', Number: 'unresolved', ListNumber: 'unresolved',
      Plain: 'r/B.md', 'Epic link': 'unresolved', Ghost: 'unresolved', Gate: 'unresolved', Sprint: 'unresolved', Nested: 'unresolved', Suite: 'unresolved',
      Numbered: 'unresolved',
    });
    expect(Object.values(target({})).every(value => value === null)).toBe(true);
  });
});

describe('release scope tree', () => {
  it('keeps members with their in-filter, non-marker ancestors as context rows, at the depth they draw', () => {
    const notes = {
      'Epic.md': { type: 'Epic' }, 'Feature.md': { type: 'Feature', parent: '[[Epic]]' }, 'Story.md': { type: 'PBI', parent: '[[Feature]]' },
      'Gate.md': { type: 'Milestone' }, 'Under gate.md': { type: 'PBI', parent: '[[Gate]]' }, 'Hidden.md': { type: 'Epic' }, 'Below hidden.md': { type: 'PBI', parent: '[[Hidden]]' },
      'Out.md': { type: 'PBI', parent: '[[Epic]]' }, 'Other.md': { type: 'Epic' },
    };
    const source = noteSource(notes), settings = resolveSettings({});
    const model = buildModel(source, Object.keys(notes).filter(path => path !== 'Hidden.md'), settings, path => path in notes);
    const members = new Set(['Story.md', 'Under gate.md', 'Below hidden.md', 'Hidden.md']);
    expect(scopeRows(model, item => members.has(item.path)).map(row => [row.item.title, row.depth, row.context])).toEqual([
      ['Epic', 0, true], ['Feature', 1, true], ['Story', 2, false], ['Under gate', 0, false], ['Below hidden', 0, false],
    ]);
  });
});
