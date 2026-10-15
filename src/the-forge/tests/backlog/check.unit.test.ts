import { describe, expect, it } from 'vitest';
import type { NoteSource } from '../../src/plugins/backlog/domain/items.ts';
import { buildModel } from '../../src/plugins/backlog/domain/model.ts';
import { checkBacklog, type CheckInput } from '../../src/plugins/backlog/domain/check.ts';
import { resolveSettings, type ViewOptions } from '../../src/plugins/backlog/domain/settings-resolve.ts';

type Notes = Record<string, Record<string, unknown>>;
/** Wikilinks are frontmatter links and resolve by basename; `types` gives the live type of a link target. */
function vault(notes: Notes): NoteSource {
  const resolve = (linkpath: string) => Object.keys(notes).find(path => path.slice(path.lastIndexOf('/') + 1, -3) === linkpath) ?? null;
  return {
    frontmatter: path => notes[path],
    frontmatterLinks: path => Object.entries(notes[path] ?? {}).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item, index) => [`${key}.${index}`, item] as const) : [[key, value] as const]))
      .flatMap(([key, value]) => (typeof value === 'string' && /^\[\[.+\]\]$/.test(value) ? [{ key, link: value.slice(2, -2) }] : [])),
    resolve,
  };
}
const bound = (): ViewOptions => ({
  stateProperty: 'note.status', dependsOnProperty: 'note.dependsOn', releaseProperty: 'note.release', horizonProperty: 'note.horizon', startProperty: 'note.start',
  targetProperty: 'note.due', iterationProperty: 'note.iteration', assigneeProperty: 'note.assignee', iterationGoalProperty: 'note.goal',
});
function check(notes: Notes, options: { results?: string[]; view?: ViewOptions; input?: Partial<CheckInput> } = {}) {
  const settings = resolveSettings({ ...bound(), ...options.view });
  const model = buildModel(vault(notes), options.results ?? Object.keys(notes), settings, path => path in notes);
  const typeOf = (path: string) => { const type = notes[path]?.type; return typeof type === 'string' ? type : null; };
  return checkBacklog({ model, settings, releaseProblems: [], unresolvedMemberships: [], typeOf, ...options.input });
}

describe('configuration problems', () => {
  it('reports shared keys and release configuration problems as errors without a note', () => {
    expect(check({}, { view: { riskProperty: 'note.status' }, input: { releaseProblems: ['The release folder is missing.'] } })).toStrictEqual([
      { code: 'config', severity: 'error', message: 'The properties state, risk all use the key "status".' },
      { code: 'release-config', severity: 'error', message: 'The release folder is missing.' },
    ]);
    expect(check({})).toStrictEqual([]);
  });

  it('reports release memberships that do not resolve', () => {
    expect(check({}, { input: { unresolvedMemberships: ['a.md'] } })).toStrictEqual([
      { code: 'unresolved-membership', severity: 'error', path: 'a.md', message: 'The release membership of a.md does not resolve to exactly one Release note of this base.' },
    ]);
  });
});

describe('link problems', () => {
  it('reports a parent loop where it is cut and a parent that does not resolve', () => {
    expect(check({ 'A.md': { type: 'Task', order: 1, parent: '[[B]]' }, 'B.md': { type: 'Task', order: 2, parent: '[[A]]' }, 'Lost.md': { type: 'PBI', order: 3, parent: '[[Nowhere]]' } }))
      .toStrictEqual([
        { code: 'parent-cycle', severity: 'error', path: 'A.md', key: 'parent', message: 'A closes a parent loop; the loop is cut here and the note shows as a root.' },
        { code: 'unresolved-parent', severity: 'error', path: 'Lost.md', key: 'parent', message: 'The parent of Lost does not resolve to a loaded note.' },
      ]);
  });

  it('reports dependency loops and dependencies that do not resolve, with the raw entry', () => {
    expect(check({ 'a.md': { type: 'PBI', order: 1, dependsOn: ['[[b]]', '[[ghost]]'] }, 'b.md': { type: 'PBI', order: 2, dependsOn: '[[a]]' } })).toStrictEqual([
      { code: 'dependency-cycle', severity: 'error', path: 'a.md', key: 'dependsOn', value: '[[b]]', message: 'a depends on [[b]], which closes a dependency loop.' },
      { code: 'unresolved-dependency', severity: 'error', path: 'a.md', key: 'dependsOn', value: '[[ghost]]', message: 'a depends on [[ghost]], which does not resolve to a loaded item.' },
      { code: 'dependency-cycle', severity: 'error', path: 'b.md', key: 'dependsOn', value: '[[a]]', message: 'b depends on [[a]], which closes a dependency loop.' },
    ]);
  });

  it('reports an iteration that is not an Iteration note as an error and an assignee that is not a Resource as a warning', () => {
    const notes = {
      'a.md': { type: 'PBI', order: 1, iteration: '[[Sprint 1]]', assignee: '[[Ada]]' }, 'b.md': { type: 'PBI', order: 2, iteration: '[[c]]', assignee: '[[c]]' },
      'c.md': { type: 'PBI', order: 3, iteration: '[[Gone]]', assignee: '[[Gone]]' }, 'Sprint 1.md': { type: 'Iteration', order: 4 }, 'Ada.md': { type: 'Resource' },
    };
    expect(check(notes)).toStrictEqual([
      { code: 'broken-iteration', severity: 'error', path: 'b.md', key: 'iteration', value: '[[c]]', message: 'b has the iteration [[c]], which is not an Iteration note.' },
      { code: 'broken-assignee', severity: 'warning', path: 'b.md', key: 'assignee', value: '[[c]]', message: 'b has the assignee [[c]], which is not a Resource note.' },
      { code: 'broken-iteration', severity: 'error', path: 'c.md', key: 'iteration', value: '[[Gone]]', message: 'c has the iteration [[Gone]], which is not an Iteration note.' },
      { code: 'broken-assignee', severity: 'warning', path: 'c.md', key: 'assignee', value: '[[Gone]]', message: 'c has the assignee [[Gone]], which is not a Resource note.' },
    ]);
  });

  it('checks only the notes the filter returned', () => {
    const notes = { 'Ctx.md': { type: 'Epic', parent: '[[Nowhere]]', dependsOn: '[[ghost]]', start: 'soon', order: 1 }, 'a.md': { type: 'PBI', parent: '[[Ctx]]', order: 1 } };
    expect(check(notes, { results: ['a.md'] })).toStrictEqual([]);
  });
});

describe('field problems', () => {
  it('reports fields the type may not hold, naming the type and key', () => {
    const notes = {
      'm.md': { type: 'Milestone', order: 1, release: '[[r]]', start: '2026-10-01' }, 't.md': { type: 'Test case', order: 2, release: ['x', 'y'] },
      'r.md': { type: 'Release', order: 3, horizon: 'Now', iteration: '[[i]]', goal: 'Ship', start: '2026-10-01', due: '2026-10-09' }, 'i.md': { type: 'Iteration', order: 4, start: '2026-10-01', due: '2026-10-14' },
    };
    const notHeld = (path: string, type: string, key: string) => ({ code: 'field-not-held', severity: 'error', path, key, message: `The ${type} item ${path.slice(0, -3)} may not hold ${key}.` });
    expect(check(notes)).toStrictEqual([
      notHeld('m.md', 'Milestone', 'release'), notHeld('m.md', 'Milestone', 'start'), notHeld('t.md', 'Test case', 'release'),
      notHeld('r.md', 'Release', 'horizon'), notHeld('r.md', 'Release', 'iteration'), notHeld('r.md', 'Release', 'goal'), notHeld('r.md', 'Release', 'start'), notHeld('r.md', 'Release', 'due'),
    ]);
  });

  it('lets other types hold every field, and ignores empty horizons and unbound keys', () => {
    expect(check({ 'p.md': { type: 'PBI', order: 1, release: '[[r]]', horizon: 'Now', iteration: '[[i]]', goal: 'x', start: '2026-10-01', due: '2026-10-09' }, 'r.md': { type: 'Release' }, 'i.md': { type: 'Iteration', order: 2 } }))
      .toStrictEqual([]);
    expect(check({ 'r.md': { type: 'Release', horizon: '' } })).toStrictEqual([]);
    expect(check({ 'r.md': { type: 'Release', horizon: 'Now', iteration: '[[i]]' }, 'i.md': { type: 'Iteration', order: 1 } }, { view: { horizonProperty: '', iterationProperty: '' } })).toStrictEqual([]);
  });

  it('warns about unreadable dates and horizons and a reversed span', () => {
    const unreadable = (path: string, key: string) => ({ code: 'unreadable-date', severity: 'warning', path, key, message: `${path.slice(0, -3)} has an unreadable ${key}; the plugin shelves it.` });
    expect(check({ 'a.md': { type: 'PBI', order: 1, start: 'soon', due: '2026-02-30', horizon: {} }, 'b.md': { type: 'PBI', order: 2, start: '2026-10-05', due: '2026-10-01' }, 'c.md': { type: 'PBI', order: 3, start: '2026-10-05', due: '2026-10-05' } }))
      .toStrictEqual([
        unreadable('a.md', 'start'), unreadable('a.md', 'due'),
        { code: 'unreadable-horizon', severity: 'warning', path: 'a.md', key: 'horizon', message: 'a has an unreadable horizon; the plugin shelves it.' },
        { code: 'reversed-span', severity: 'warning', path: 'b.md', message: 'b starts after its target date.' },
      ]);
  });
});

describe('rank problems', () => {
  it('warns about rank ties among results and about unranked results other than releases', () => {
    const notes = {
      'a.md': { type: 'PBI', order: 1 }, 'b.md': { type: 'PBI', order: 1 }, 'c.md': { type: 'PBI', order: 2 }, 'd.md': { type: 'PBI', order: 1.5 }, 'e.md': { type: 'PBI', order: 1.5 },
      'u.md': { type: 'PBI' }, 'r.md': { type: 'Release' }, 'v.md': { type: 'Task' },
    };
    expect(check(notes)).toStrictEqual([
      { code: 'rank-tie', severity: 'warning', value: '1', paths: ['a.md', 'b.md'], message: '2 items share rank 1; ties follow result order.' },
      { code: 'rank-tie', severity: 'warning', value: '1.5', paths: ['d.md', 'e.md'], message: '2 items share rank 1.5; ties follow result order.' },
      { code: 'unranked', severity: 'warning', paths: ['u.md', 'v.md'], message: '2 items have no rank and sort last; run backlog ranks seed.' },
    ]);
  });

  it('leaves context rows out of ties and unranked counts', () => {
    const notes = { 'Ctx.md': { type: 'Epic', order: 1 }, 'Top.md': { type: 'Epic' }, 'a.md': { type: 'PBI', parent: '[[Ctx]]', order: 1 }, 'b.md': { type: 'PBI', parent: '[[Top]]', order: 2 } };
    expect(check(notes, { results: ['a.md', 'b.md'] })).toStrictEqual([]);
  });
});
