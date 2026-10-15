import { describe, expect, it } from 'vitest';
import { resolveSettings, type ViewOptions } from '../../src/plugins/backlog/domain/settings-resolve.ts';
import { applyItemWrite, type AxisWrite, type ItemWrite, type WriteEnv } from '../../src/plugins/backlog/domain/writes.ts';

/** Joining a release fills the item's empty planned dates from the release; these tests pin which dates land. */
const types: Record<string, string> = { 'r/1.0.md': 'Release', 'r/1.5.md': 'Release', 'r/0.9.md': 'Release' };
const env = (options: ViewOptions): WriteEnv => ({
  settings: resolveSettings({ startProperty: 'note.start', targetProperty: 'note.due', releaseProperty: 'note.release', ...options }),
  wikilink: target => `[[${target.slice(target.lastIndexOf('/') + 1, -3)}]]`,
  resolve: linkpath => Object.keys(types).find(path => path.endsWith(`/${linkpath}.md`)) ?? null,
  typeOf: path => types[path] ?? null,
});
const fill = (frontmatter: Record<string, unknown>, axis: Omit<AxisWrite, 'fillOnly'>, write: Omit<ItemWrite, 'path' | 'axis'> = { release: 'r/1.0.md' }, options: ViewOptions = {}) => {
  const copy = structuredClone(frontmatter);
  expect(applyItemWrite(copy, { path: 'n/Item.md', ...write, axis: { ...axis, fillOnly: true } }, env(options))).toBeNull();
  return copy;
};
const release = () => ({ start: '2026-10-01', target: '2026-12-01' });

describe('filling dates on joining a release', () => {
  it('fills only empty dates, and nothing when the note already names the release', () => {
    expect(fill({ type: 'PBI' }, release())).toStrictEqual({ type: 'PBI', release: '[[1.0]]', start: '2026-10-01', due: '2026-12-01' });
    expect(fill({ type: 'PBI', due: '2026-11-01' }, release())).toStrictEqual({ type: 'PBI', due: '2026-11-01', release: '[[1.0]]', start: '2026-10-01' });
    expect(fill({ type: 'PBI', start: '2027-01-01' }, release())).toStrictEqual({ type: 'PBI', start: '2027-01-01', release: '[[1.0]]' });
    expect(fill({ type: 'PBI', release: '[[1.0]]' }, release())).toStrictEqual({ type: 'PBI', release: '[[1.0]]' });
  });

  it.each<[string, unknown]>([
    ['a bare link name', '1.0'], ['a one-entry list', ['[[1.0]]']], ['a padded aliased link', ' [[1.0|One]] '], ['a heading link', '[[1.0#Scope]]'],
  ])('treats %s to the same release as already joined', (_, named) => {
    expect(fill({ type: 'PBI', release: named }, release())).toStrictEqual({ type: 'PBI', release: named });
  });

  it.each<[string, unknown, string]>([
    ['another release', '[[0.9]]', '1.0'], ['two releases', ['[[1.0]]', '[[0.9]]'], '1.0'], ['an empty list', [], '1.0'], ['an empty value', '', '1.0'],
    ['a number', 1.5, '1.5'], ['a one-entry number list', [1.5], '1.5'], ['an unresolved link', '[[Gone]]', '1.0'],
  ])('fills the dates when the note names %s', (_, named, version) => {
    expect(fill({ type: 'PBI', release: named }, release(), { release: `r/${version}.md` }))
      .toStrictEqual({ type: 'PBI', release: `[[${version}]]`, start: '2026-10-01', due: '2026-12-01' });
  });

  it('fills nothing without a release to join or without a release key', () => {
    expect(fill({ type: 'PBI' }, release(), {})).toStrictEqual({ type: 'PBI' });
    expect(fill({ type: 'PBI' }, release(), { release: null })).toStrictEqual({ type: 'PBI' });
    expect(fill({ type: 'PBI' }, release(), { release: 'r/1.0.md' }, { releaseProperty: '' })).toStrictEqual({ type: 'PBI' });
  });

  it('leaves out a date that would reverse the span', () => {
    expect(fill({ type: 'PBI', due: '2026-09-01' }, release())).toStrictEqual({ type: 'PBI', due: '2026-09-01', release: '[[1.0]]' });
    expect(fill({ type: 'PBI', start: '2026-12-15' }, release())).toStrictEqual({ type: 'PBI', start: '2026-12-15', release: '[[1.0]]' });
    expect(fill({ type: 'PBI' }, { start: '2026-12-01', target: '2026-11-01' })).toStrictEqual({ type: 'PBI', release: '[[1.0]]', due: '2026-11-01' });
    expect(fill({ type: 'PBI', start: '2026-12-01' }, { start: '2026-10-01', target: '2026-12-01' })).toStrictEqual({ type: 'PBI', start: '2026-12-01', release: '[[1.0]]', due: '2026-12-01' });
    expect(fill({ type: 'PBI', due: '2026-10-01' }, release())).toStrictEqual({ type: 'PBI', due: '2026-10-01', release: '[[1.0]]', start: '2026-10-01' });
  });

  it('fills the start against no target when the target is unbound', () => {
    expect(fill({ type: 'PBI' }, { start: '2026-12-01', target: '2026-11-01' }, { release: 'r/1.0.md' }, { targetProperty: '' }))
      .toStrictEqual({ type: 'PBI', release: '[[1.0]]', start: '2026-12-01' });
  });

  it('fills against unreadable live dates as if they were empty', () => {
    expect(fill({ type: 'PBI', start: 'soon', due: [] }, release())).toStrictEqual({ type: 'PBI', start: '2026-10-01', due: '2026-12-01', release: '[[1.0]]' });
  });
});
