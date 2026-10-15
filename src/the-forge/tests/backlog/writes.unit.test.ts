import { describe, expect, it } from 'vitest';
import { resolveSettings, type ViewOptions } from '../../src/plugins/backlog/domain/settings-resolve.ts';
import { applyItemWrite, type ItemWrite, type WriteEnv } from '../../src/plugins/backlog/domain/writes.ts';

/** Every optional property bound to a `note.` key; a test overrides options to unbind one. */
const boundOptions = (): ViewOptions => ({
  stateProperty: 'note.status', stateValues: 'Open, Active, Done', startedStates: 'Active', startedDateProperty: 'note.started', finishedDateProperty: 'note.finished',
  startProperty: 'note.start', targetProperty: 'note.due', horizonProperty: 'note.horizon', dependsOnProperty: 'note.dependsOn', releaseProperty: 'note.release',
  iterationProperty: 'note.iteration', assigneeProperty: 'note.assignee', riskProperty: 'note.risk', priorityProperty: 'note.priority', iterationGoalProperty: 'note.goal',
});
const types: Record<string, string> = { 'r/1.0.md': 'Release', 'p/Ada.md': 'Resource', 'n/Other.md': 'PBI', 'n/A.md': 'PBI', 'i/1 - Iteration.md': 'Iteration' };
/** Settings and environment resolve inside each test, so a mutant is active while they are read. */
const env = (options: ViewOptions): WriteEnv => ({
  settings: resolveSettings({ ...boundOptions(), ...options }),
  wikilink: target => `[[${target.slice(target.lastIndexOf('/') + 1, -3)}]]`,
  resolve: linkpath => Object.keys(types).find(path => path.endsWith(`/${linkpath}.md`)) ?? null,
  typeOf: path => types[path] ?? null,
});
const apply = (frontmatter: Record<string, unknown>, write: Omit<ItemWrite, 'path'>, options: ViewOptions = {}) => {
  const copy = structuredClone(frontmatter);
  return { refusal: applyItemWrite(copy, { path: 'n/Item.md', ...write }, env(options)), frontmatter: copy };
};
const written = (frontmatter: Record<string, unknown>, write: Omit<ItemWrite, 'path'>, options: ViewOptions = {}) => {
  const result = apply(frontmatter, write, options);
  expect(result.refusal).toBeNull();
  return result.frontmatter;
};

describe('state writes', () => {
  it('stamps started on entering a started state once, and finished on crossing into done', () => {
    expect(written({ type: 'PBI', status: 'Open' }, { state: 'Active', startedDate: '2026-10-01', finish: { date: '2026-10-01', toDone: false } }))
      .toStrictEqual({ type: 'PBI', status: 'Active', started: '2026-10-01' });
    expect(written({ type: 'PBI', status: 'Open', started: '2026-09-01' }, { state: 'Active', startedDate: '2026-10-01' }).started).toBe('2026-09-01');
    expect(written({ type: 'PBI', status: 'active', started: '' }, { state: 'Active', startedDate: '2026-10-01' }).started).toBe('');
    expect(written({ type: 'PBI', status: 'Active' }, { state: 'Done', finish: { date: '2026-10-02', toDone: true } })).toStrictEqual({ type: 'PBI', status: 'Done', finished: '2026-10-02' });
    expect(written({ type: 'PBI', status: 'Done', finished: '2026-10-02' }, { state: 'done', finish: { date: '2026-10-05', toDone: true } }).finished).toBe('2026-10-02');
    expect(written({ type: 'PBI', status: 'Done', finished: '2026-10-02' }, { state: 'Active', finish: { date: '2026-10-05', toDone: false } })).toStrictEqual({ type: 'PBI', status: 'Active' });
    expect(written({ type: 'PBI', status: 'Open', finished: 'x' }, { state: 'Active', finish: { date: '2026-10-05', toDone: false } })).toStrictEqual({ type: 'PBI', status: 'Active', finished: 'x' });
    expect(written({ type: 'PBI', status: 'Done' }, { removeStateKey: true })).toStrictEqual({ type: 'PBI' });
    expect(written({ type: 'PBI', status: 'Done' }, { state: 'Open', removeStateKey: true })).toStrictEqual({ type: 'PBI' });
  });

  it('stamps started on a note without a state, and adds no date when none is given', () => {
    expect(written({ type: 'PBI' }, { state: 'Active', startedDate: '2026-10-01' })).toStrictEqual({ type: 'PBI', status: 'Active', started: '2026-10-01' });
    expect(written({ type: 'PBI', status: 'Open' }, { state: 'Active' })).toStrictEqual({ type: 'PBI', status: 'Active' });
    expect(written({ type: 'PBI', status: 'Open' }, { startedDate: '2026-10-01' })).toStrictEqual({ type: 'PBI', status: 'Open' });
  });

  it.each<[string, unknown]>([['null', null], ['empty', ''], ['blank', '  '], ['empty list', []], ['blank list', ['', ' ']], ['null list', [null]]])(
    'treats a %s started value as unset', (_, started) => {
      expect(written({ type: 'PBI', status: 'Open', started }, { state: 'Active', startedDate: '2026-10-01' }).started).toBe('2026-10-01');
    },
  );

  it.each<[string, unknown]>([['a number', 5], ['a dated list', ['2026-09-01']], ['a date', '2026-09-01'], ['an object', {}]])(
    'keeps %s as the started value', (_, started) => {
      expect(written({ type: 'PBI', status: 'Open', started }, { state: 'Active', startedDate: '2026-10-01' }).started).toStrictEqual(started);
    },
  );

  it('writes the deliverable and test workflows to their own keys, falling back to the state key', () => {
    const own = { deliverableStateProperty: 'note.built', testStateProperty: 'note.verdict' };
    expect(written({ type: 'Deliverable' }, { deliverableState: 'Built', testState: 'Passed' }, own)).toStrictEqual({ type: 'Deliverable', built: 'Built', verdict: 'Passed' });
    expect(written({ type: 'Deliverable', built: 'Built', verdict: 'Passed', status: 'Open' }, { removeDeliverableStateKey: true, removeTestStateKey: true }, own))
      .toStrictEqual({ type: 'Deliverable', status: 'Open' });
    expect(written({ type: 'Deliverable' }, { deliverableState: 'Built' })).toStrictEqual({ type: 'Deliverable', status: 'Built' });
    expect(written({ type: 'Test case' }, { testState: 'Passed' })).toStrictEqual({ type: 'Test case', status: 'Passed' });
    expect(written({ type: 'Test case', status: 'Passed' }, { removeTestStateKey: true })).toStrictEqual({ type: 'Test case' });
  });

  it('writes nothing for an unbound state, started or finished property', () => {
    const unbound = { stateProperty: '', startedDateProperty: '', finishedDateProperty: '' };
    expect(written({ type: 'PBI' }, { state: 'Active', deliverableState: 'Built', testState: 'Passed', startedDate: '2026-10-01', finish: { date: '2026-10-02', toDone: true } }, unbound))
      .toStrictEqual({ type: 'PBI' });
    expect(written({ type: 'PBI', status: 'Open' }, { state: 'Active', startedDate: '2026-10-01', finish: { date: '2026-10-02', toDone: true } }, { startedDateProperty: '', finishedDateProperty: '' }))
      .toStrictEqual({ type: 'PBI', status: 'Active' });
  });
});

describe('refusals', () => {
  it('refuses Resource notes, fields a type may not hold, non-Release and non-Resource targets and reversed spans', () => {
    expect(apply({ type: 'Resource' }, { state: 'Done' }).refusal).toBe('resource');
    expect(apply({ type: ['resource'] }, { order: 1 }).refusal).toBe('resource');
    expect(apply({ type: 'Milestone' }, { release: 'r/1.0.md' }).refusal).toBe('field-not-held');
    expect(apply({ type: 'Test case' }, { release: 'r/1.0.md' }).refusal).toBe('field-not-held');
    expect(apply({ type: 'Release' }, { axis: { horizon: 'Now' } }).refusal).toBe('field-not-held');
    expect(apply({ type: 'Release' }, { axis: { start: '2026-10-01' } }).refusal).toBe('field-not-held');
    expect(apply({ type: 'Release' }, { axis: { target: '2026-10-01' } }).refusal).toBe('field-not-held');
    expect(apply({ type: 'Release' }, { iteration: 'i/1 - Iteration.md' }).refusal).toBe('field-not-held');
    expect(apply({ type: 'Release' }, { iterationGoal: 'Ship' }).refusal).toBe('field-not-held');
    expect(apply({ type: 'PBI' }, { release: 'n/Other.md' }).refusal).toBe('not-a-release');
    expect(apply({ type: 'PBI' }, { release: 'n/Missing.md' }).refusal).toBe('not-a-release');
    expect(apply({ type: 'PBI' }, { assignee: 'n/Other.md' }).refusal).toBe('not-a-resource');
    expect(apply({ type: 'PBI', start: '2026-10-10' }, { axis: { target: '2026-10-01', ends: ['start', 'target'] } }).refusal).toBe('reversed-span');
    expect(apply({ type: 'Milestone' }, { axis: { target: '2026-10-01', ends: ['start', 'target'] } }).refusal).toBe('field-not-held');
  });

  it('accepts cleared fields on any type and refuses nothing it applied', () => {
    expect(written({ type: 'Release', horizon: 'Now', goal: 'x' }, { axis: { horizon: null }, iterationGoal: null })).toStrictEqual({ type: 'Release' });
    expect(written({ type: 'Milestone', release: '[[1.0]]' }, { release: null })).toStrictEqual({ type: 'Milestone' });
    expect(written({ type: 'PBI', assignee: '[[Ada]]', iteration: '[[x]]' }, { assignee: null, iteration: null })).toStrictEqual({ type: 'PBI' });
  });

  it('checks the planned ends against the live type, and the span only for two-ended types', () => {
    expect(apply({ type: 'Milestone' }, { axis: { start: '2026-10-01', ends: ['start'] } }).refusal).toBe('field-not-held');
    expect(apply({ type: 'PBI' }, { axis: { target: '2026-10-01', ends: ['target'] } }).refusal).toBe('field-not-held');
    expect(written({ type: 'Milestone', start: '2026-12-01' }, { axis: { target: '2026-10-01', ends: ['target'] } })).toStrictEqual({ type: 'Milestone', start: '2026-12-01', due: '2026-10-01' });
    expect(written({ type: 'Iteration', start: '2026-10-01' }, { axis: { target: '2026-10-15', ends: ['start', 'target'] } }, { iterationBars: true }))
      .toStrictEqual({ type: 'Iteration', start: '2026-10-01', due: '2026-10-15' });
    expect(apply({ type: 'Iteration' }, { axis: { target: '2026-10-15', ends: ['start', 'target'] } }).refusal).toBe('field-not-held');
  });

  it('compares the requested span, reading a missing end from the note and a cleared end as open', () => {
    expect(written({ type: 'PBI', start: '2026-10-01' }, { axis: { target: '2026-10-01', ends: ['target', 'start'] } })).toStrictEqual({ type: 'PBI', start: '2026-10-01', due: '2026-10-01' });
    expect(written({ type: 'PBI', start: '2026-10-10' }, { axis: { start: null, target: '2026-10-01', ends: ['start', 'target'] } })).toStrictEqual({ type: 'PBI', due: '2026-10-01' });
    expect(written({ type: 'PBI', due: '2026-10-01' }, { axis: { start: '2026-11-01', target: null, ends: ['start', 'target'] } })).toStrictEqual({ type: 'PBI', start: '2026-11-01' });
    expect(apply({ type: 'PBI', due: '2026-10-01' }, { axis: { start: '2026-11-01', ends: ['start', 'target'] } }).refusal).toBe('reversed-span');
    expect(apply({ type: 'PBI' }, { axis: { start: '2026-11-01', target: '2026-10-01', ends: ['start', 'target'] } }).refusal).toBe('reversed-span');
    expect(apply({ type: 'PBI', start: '2026-11-01', due: '2026-10-01' }, { axis: { horizon: 'Now', ends: ['start', 'target'] } }).refusal).toBe('reversed-span');
  });
});

describe('structure and labels', () => {
  it('writes only the keys a write names', () => {
    expect(written({ type: 'PBI' }, {})).toStrictEqual({ type: 'PBI' });
    expect(written({ type: 'PBI' }, { order: 1500 })).toStrictEqual({ type: 'PBI', order: 1500 });
    expect(written({ type: 'PBI' }, { typeName: 'Bug' })).toStrictEqual({ type: 'Bug' });
    expect(written({ type: 'PBI' }, { parent: 'n/Other.md' })).toStrictEqual({ type: 'PBI', parent: '[[Other]]' });
  });

  it('clears a parent by deleting it, or by emptying it under a folder hierarchy', () => {
    expect(written({ type: 'PBI', parent: '[[Old]]' }, { parent: null, order: 1500 })).toStrictEqual({ type: 'PBI', order: 1500 });
    expect(written({ type: 'PBI', parent: '[[Old]]' }, { parent: null }, { inferFolderHierarchy: true })).toStrictEqual({ type: 'PBI', parent: '' });
  });

  it('writes links as wikilinks, deletes cleared keys and skips unbound ones', () => {
    expect(written({ type: 'PBI', assignee: '' }, { assignee: 'p/Ada.md', iteration: 'i/1 - Iteration.md', release: 'r/1.0.md', risk: '1 - High' }))
      .toStrictEqual({ type: 'PBI', assignee: '[[Ada]]', iteration: '[[1 - Iteration]]', release: '[[1.0]]', risk: '1 - High' });
    expect(written({ type: 'PBI', assignee: '[[Ada]]', iteration: '[[1 - Iteration]]', release: '[[1.0]]' }, { assignee: null, iteration: null, release: null }))
      .toStrictEqual({ type: 'PBI' });
    expect(written({ type: 'PBI' }, { assignee: 'p/Ada.md', iteration: 'i/1 - Iteration.md', release: 'r/1.0.md' }, { assigneeProperty: '', iterationProperty: '', releaseProperty: '' }))
      .toStrictEqual({ type: 'PBI' });
  });

  it('sets, clears and skips risk, priority and iteration goal labels', () => {
    expect(written({ type: 'PBI' }, { risk: '1 - High', priority: '1 - Must', iterationGoal: 'Ship' })).toStrictEqual({ type: 'PBI', risk: '1 - High', priority: '1 - Must', goal: 'Ship' });
    expect(written({ type: 'PBI', risk: 'x', priority: 'y', goal: 'z' }, { risk: null, priority: null, iterationGoal: null })).toStrictEqual({ type: 'PBI' });
    expect(written({ type: 'PBI', risk: 'x' }, { priority: '1 - Must' })).toStrictEqual({ type: 'PBI', risk: 'x', priority: '1 - Must' });
    expect(written({ type: 'PBI' }, { risk: '1 - High', priority: '1 - Must', iterationGoal: 'Ship' }, { riskProperty: '', priorityProperty: '', iterationGoalProperty: '' }))
      .toStrictEqual({ type: 'PBI' });
  });
});

describe('planned horizon and dates', () => {
  it('sets and clears the horizon and the dates, skipping unbound keys', () => {
    expect(written({ type: 'PBI' }, { axis: { horizon: 'Next', start: '2026-10-01', target: '2026-10-09' } })).toStrictEqual({ type: 'PBI', horizon: 'Next', start: '2026-10-01', due: '2026-10-09' });
    expect(written({ type: 'PBI', horizon: 'Now', start: '2026-10-01', due: '2026-10-09' }, { axis: { horizon: null, start: null, target: null } })).toStrictEqual({ type: 'PBI' });
    expect(written({ type: 'PBI' }, { axis: { horizon: 'Next', start: '2026-10-01', target: '2026-10-09' } }, { horizonProperty: '', startProperty: '', targetProperty: '' }))
      .toStrictEqual({ type: 'PBI' });
    expect(written({ type: 'PBI', horizon: 'Now' }, { axis: { start: '2026-10-01' } })).toStrictEqual({ type: 'PBI', horizon: 'Now', start: '2026-10-01' });
  });

  it.each<[string, unknown, unknown]>([
    ['keeps a time suffix', '2026-10-01T09:30', '2026-10-03T09:30'],
    ['keeps a space-separated time', '2026-10-01 09:30', '2026-10-03 09:30'],
    ['keeps the suffix of a padded date', ' 2026-10-01T09:30 ', '2026-10-03T09:30'],
    ['leaves an equal date alone', '2026-10-3', '2026-10-3'],
    ['leaves an equal timed date alone', '2026-10-03T08:00', '2026-10-03T08:00'],
    ['writes into the first list entry', ['2026-10-01T09:30', 'x'], ['2026-10-03T09:30', 'x']],
    ['replaces an empty list with the date', [], '2026-10-03'],
    ['replaces an invalid timed date without its suffix', '2026-13-01T09:00', '2026-10-03'],
    ['replaces text', 'soon', '2026-10-03'],
    ['replaces a number', 20261001, '2026-10-03'],
  ])('%s', (_, live, expected) => {
    expect(written({ type: 'PBI', start: live }, { axis: { start: '2026-10-03' } }).start).toStrictEqual(expected);
  });
});

describe('tags', () => {
  it('adds normalized tags once, removes tags case-insensitively and deletes an emptied key', () => {
    expect(written({ type: 'PBI' }, { tags: { add: ['#needs review!', 'Needs-Review', '2026', ''] } })).toStrictEqual({ type: 'PBI', tags: ['needs-review'] });
    expect(written({ type: 'PBI', tags: 'a, B' }, { tags: { add: ['b', 'c'] } })).toStrictEqual({ type: 'PBI', tags: ['a', 'B', 'c'] });
    expect(written({ type: 'PBI', tags: ['a', 'b'] }, { tags: { remove: ['A'] } })).toStrictEqual({ type: 'PBI', tags: ['b'] });
    expect(written({ type: 'PBI', tags: ['a'] }, { tags: { remove: ['a'] } })).toStrictEqual({ type: 'PBI' });
    expect(written({ type: 'PBI', tags: ['a'] }, { tags: { remove: ['a'], add: ['a'] } })).toStrictEqual({ type: 'PBI', tags: ['a'] });
  });

  it('leaves tags untouched when nothing changes or the key is unbound', () => {
    expect(written({ type: 'PBI', tags: 'a, b' }, { tags: { add: ['A', '42'], remove: ['c'] } })).toStrictEqual({ type: 'PBI', tags: 'a, b' });
    expect(written({ type: 'PBI', tags: '#a' }, { tags: {} })).toStrictEqual({ type: 'PBI', tags: '#a' });
    expect(written({ type: 'PBI' }, { tags: { remove: ['a'] } })).toStrictEqual({ type: 'PBI' });
    expect(written({ type: 'PBI', tags: ['a'] }, { tags: { add: ['b'], remove: ['a'] } }, { tagsProperty: '' })).toStrictEqual({ type: 'PBI', tags: ['a'] });
  });
});

describe('dependencies', () => {
  it('keeps dependsOn a list of wikilinks and deletes the key when it empties', () => {
    expect(written({ type: 'PBI' }, { dependsOn: { add: 'n/Other.md' } }).dependsOn).toStrictEqual(['[[Other]]']);
    expect(written({ type: 'PBI', dependsOn: '[[Other]]' }, { dependsOn: { add: 'n/Other.md' } }).dependsOn).toBe('[[Other]]');
    expect(written({ type: 'PBI', dependsOn: ['[[A]]'] }, { dependsOn: { add: 'n/Other.md' } }).dependsOn).toStrictEqual(['[[A]]', '[[Other]]']);
    expect(written({ type: 'PBI', dependsOn: [42, ''] }, { dependsOn: { add: 'n/Other.md' } }).dependsOn).toStrictEqual([42, '', '[[Other]]']);
    expect(written({ type: 'PBI', dependsOn: ['[[Other]]', 42, '[[Gone]]'] }, { dependsOn: { removePath: 'n/Other.md' } }).dependsOn).toStrictEqual([42, '[[Gone]]']);
    expect(written({ type: 'PBI', dependsOn: ['[[Gone]]'] }, { dependsOn: { removeRaw: '[[Gone]]' } })).toStrictEqual({ type: 'PBI' });
  });

  it('removes only the matching entries, compared trimmed', () => {
    expect(written({ type: 'PBI', dependsOn: ['[[A]]', ' [[Gone]] '] }, { dependsOn: { removeRaw: '[[Gone]]' } }).dependsOn).toStrictEqual(['[[A]]']);
    expect(written({ type: 'PBI', dependsOn: ['[[A]]', '[[Other|alias]]'] }, { dependsOn: { removePath: 'n/Other.md' } }).dependsOn).toStrictEqual(['[[A]]']);
    expect(written({ type: 'PBI', dependsOn: ['[[A]]', '[[Missing]]'] }, { dependsOn: { removePath: 'n/Other.md' } }).dependsOn).toStrictEqual(['[[A]]', '[[Missing]]']);
    expect(written({ type: 'PBI', dependsOn: ['[[A]]', '[[Other]]'] }, { dependsOn: { removeRaw: '[[Other]]', add: 'n/Other.md' } }).dependsOn).toStrictEqual(['[[A]]', '[[Other]]']);
  });

  it('writes nothing when the list does not change or the key is unbound', () => {
    expect(written({ type: 'PBI', dependsOn: '[[A]]' }, { dependsOn: { removeRaw: '[[B]]' } })).toStrictEqual({ type: 'PBI', dependsOn: '[[A]]' });
    expect(written({ type: 'PBI' }, { dependsOn: {} })).toStrictEqual({ type: 'PBI' });
    expect(written({ type: 'PBI' }, { dependsOn: { add: 'n/Other.md' } }, { dependsOnProperty: '' })).toStrictEqual({ type: 'PBI' });
  });
});
