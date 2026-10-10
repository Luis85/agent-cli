import { describe, expect, it } from 'vitest';
import { resolveSettings } from '../../src/plugins/backlog/domain/settings-resolve.ts';
import { applyItemWrite, type ItemWrite, type WriteEnv } from '../../src/plugins/backlog/domain/writes.ts';
import { linkpathFromRawValue, readTags, normalizeTag, readDate, typedTags } from '../../src/plugins/backlog/domain/fields.ts';

const settings = resolveSettings({
  stateProperty: 'note.status', stateValues: 'Open, Active, Done', startedStates: 'Active', startedDateProperty: 'note.started', finishedDateProperty: 'note.finished',
  startProperty: 'note.start', targetProperty: 'note.due', horizonProperty: 'note.horizon', dependsOnProperty: 'note.dependsOn', releaseProperty: 'note.release',
  iterationProperty: 'note.iteration', assigneeProperty: 'note.assignee', riskProperty: 'note.risk',
});
const types: Record<string, string> = { 'r/1.0.md': 'Release', 'p/Ada.md': 'Resource', 'n/Other.md': 'PBI', 'i/1 - Iteration.md': 'Iteration' };
const env: WriteEnv = {
  settings,
  wikilink: target => `[[${target.slice(target.lastIndexOf('/') + 1, -3)}]]`,
  resolve: linkpath => Object.keys(types).find(path => path.endsWith(`/${linkpath}.md`)) ?? null,
  typeOf: path => types[path] ?? null,
};
const apply = (frontmatter: Record<string, unknown>, write: Omit<ItemWrite, 'path'>) => {
  const copy = structuredClone(frontmatter);
  return { refusal: applyItemWrite(copy, { path: 'n/Item.md', ...write }, env), frontmatter: copy };
};

describe('state writes', () => {
  it('stamps started on entering a started state once, and finished on crossing into done', () => {
    expect(apply({ type: 'PBI', status: 'Open' }, { state: 'Active', startedDate: '2026-10-01', finish: { date: '2026-10-01', toDone: false } }).frontmatter)
      .toEqual({ type: 'PBI', status: 'Active', started: '2026-10-01' });
    expect(apply({ type: 'PBI', status: 'Open', started: '2026-09-01' }, { state: 'Active', startedDate: '2026-10-01' }).frontmatter.started).toBe('2026-09-01');
    expect(apply({ type: 'PBI', status: 'active', started: '' }, { state: 'Active', startedDate: '2026-10-01' }).frontmatter.started).toBe('');
    expect(apply({ type: 'PBI', status: 'Active' }, { state: 'Done', finish: { date: '2026-10-02', toDone: true } }).frontmatter).toEqual({ type: 'PBI', status: 'Done', finished: '2026-10-02' });
    expect(apply({ type: 'PBI', status: 'Done', finished: '2026-10-02' }, { state: 'done', finish: { date: '2026-10-05', toDone: true } }).frontmatter.finished).toBe('2026-10-02');
    expect(apply({ type: 'PBI', status: 'Done', finished: '2026-10-02' }, { state: 'Active', finish: { date: '2026-10-05', toDone: false } }).frontmatter).toEqual({ type: 'PBI', status: 'Active' });
    expect(apply({ type: 'PBI', status: 'Done' }, { removeStateKey: true }).frontmatter).toEqual({ type: 'PBI' });
  });
});

describe('refusals', () => {
  it('refuses Resource notes, fields a type may not hold, non-Release and non-Resource targets and reversed spans', () => {
    expect(apply({ type: 'Resource' }, { state: 'Done' }).refusal).toBe('resource');
    expect(apply({ type: 'Milestone' }, { release: 'r/1.0.md' }).refusal).toBe('field-not-held');
    expect(apply({ type: 'Release' }, { axis: { horizon: 'Now' } }).refusal).toBe('field-not-held');
    expect(apply({ type: 'Release' }, { axis: { horizon: null } }).refusal).toBeNull();
    expect(apply({ type: 'PBI' }, { release: 'n/Other.md' }).refusal).toBe('not-a-release');
    expect(apply({ type: 'PBI' }, { assignee: 'n/Other.md' }).refusal).toBe('not-a-resource');
    expect(apply({ type: 'PBI', start: '2026-10-10' }, { axis: { target: '2026-10-01', ends: ['start', 'target'] } }).refusal).toBe('reversed-span');
    expect(apply({ type: 'Milestone' }, { axis: { target: '2026-10-01', ends: ['start', 'target'] } }).refusal).toBe('field-not-held');
  });
});

describe('links, dates and lists', () => {
  it('writes links as wikilinks and deletes cleared keys', () => {
    expect(apply({ type: 'PBI', parent: '[[Old]]' }, { parent: null, order: 1500 }).frontmatter).toEqual({ type: 'PBI', order: 1500 });
    expect(apply({ type: 'PBI', assignee: '' }, { assignee: 'p/Ada.md', iteration: 'i/1 - Iteration.md', risk: '1 - High' }).frontmatter)
      .toEqual({ type: 'PBI', assignee: '[[Ada]]', iteration: '[[1 - Iteration]]', risk: '1 - High' });
  });

  it('keeps a time suffix and leaves an equal date alone', () => {
    expect(apply({ type: 'PBI', start: '2026-10-01T09:30' }, { axis: { start: '2026-10-03' } }).frontmatter.start).toBe('2026-10-03T09:30');
    expect(apply({ type: 'PBI', start: '2026-10-3' }, { axis: { start: '2026-10-03' } }).frontmatter.start).toBe('2026-10-3');
    expect(apply({ type: 'PBI', due: ['2026-10-01', 'x'] }, { axis: { target: '2026-11-01' } }).frontmatter.due).toEqual(['2026-11-01', 'x']);
  });

  it('fills release dates only while empty, and only when joining changes the membership', () => {
    const join = { release: 'r/1.0.md', axis: { fillOnly: true, start: '2026-10-01', target: '2026-12-01' } };
    expect(apply({ type: 'PBI' }, join).frontmatter).toEqual({ type: 'PBI', release: '[[1.0]]', start: '2026-10-01', due: '2026-12-01' });
    expect(apply({ type: 'PBI', due: '2026-11-01' }, join).frontmatter).toEqual({ type: 'PBI', due: '2026-11-01', release: '[[1.0]]', start: '2026-10-01' });
    expect(apply({ type: 'PBI', start: '2027-01-01' }, join).frontmatter).toEqual({ type: 'PBI', start: '2027-01-01', release: '[[1.0]]' });
    expect(apply({ type: 'PBI', release: '[[1.0]]' }, join).frontmatter).toEqual({ type: 'PBI', release: '[[1.0]]' });
  });

  it('keeps dependsOn a list of wikilinks and deletes the key when it empties', () => {
    expect(apply({ type: 'PBI' }, { dependsOn: { add: 'n/Other.md' } }).frontmatter.dependsOn).toEqual(['[[Other]]']);
    expect(apply({ type: 'PBI', dependsOn: '[[Other]]' }, { dependsOn: { add: 'n/Other.md' } }).frontmatter.dependsOn).toBe('[[Other]]');
    expect(apply({ type: 'PBI', dependsOn: ['[[Other]]', 42, '[[Gone]]'] }, { dependsOn: { removePath: 'n/Other.md' } }).frontmatter.dependsOn).toEqual([42, '[[Gone]]']);
    expect(apply({ type: 'PBI', dependsOn: ['[[Gone]]'] }, { dependsOn: { removeRaw: '[[Gone]]' } }).frontmatter).toEqual({ type: 'PBI' });
  });

  it('reads values tolerantly', () => {
    expect(linkpathFromRawValue(' [[Folder/Note#Heading|Alias]] ')).toBe('Folder/Note');
    expect(linkpathFromRawValue('Bare name')).toBe('Bare name');
    expect(readTags(['#a, b', 'A c', 3])).toEqual(['a', 'b', 'c']);
    expect(normalizeTag(' #needs review! ')).toBe('needs-review');
    expect(normalizeTag('2026')).toBe('');
    expect(typedTags(['#Sprint-12!, sprint-12 2026-07', '2026 ##x//y/ release--candidate'])).toEqual(['Sprint-12', '2026-07', 'x/y', 'release--candidate']);
    expect(readDate('2026-02-30')).toEqual({ value: null, invalid: true });
    expect(readDate('2026-2-3 10:00')).toEqual({ value: { year: 2026, month: 2, day: 3 }, invalid: false });
    expect(readDate(20261001)).toEqual({ value: null, invalid: true });
  });
});
