import { describe, expect, it } from 'vitest';
import {
  configProblems, defaultSettings, isDoneValue, isStartedValue, menuValues, ownedProperties, workflowKey, workflowOf, workflowValues,
} from '../../src/plugins/backlog/domain/settings.ts';
import {
  membershipCollision, normalizePath, releaseNoteProblems, resolveReleaseSettings, resolveSettings, vaultFolder, type ViewOptions,
} from '../../src/plugins/backlog/domain/settings-resolve.ts';
import { LEVELS, TEST_LEVELS } from '../../src/plugins/backlog/domain/vocabulary.ts';

const done = ['Done', 'Closed', 'Completed', 'Removed'];

describe('default backlog settings', () => {
  it('bind only the hierarchy and tags keys and the release date, with backlog-view\'s value lists and folders', () => {
    expect({ ...defaultSettings(), typeFolders: { ...defaultSettings().typeFolders }, wipLimits: { ...defaultSettings().wipLimits } }).toEqual({
      parentKey: 'parent', orderKey: 'order', typeKey: 'type', hierarchyOnly: true, showOutsideParents: true, folderHierarchy: false, showCounts: true,
      homeFolder: 'docs', resourceFolder: 'docs/resources',
      typeFolders: {
        epic: 'docs/requirements', feature: 'docs/requirements', pbi: 'docs/requirements', task: 'docs/tasks', issue: 'docs/issues', bug: 'docs/bugs', idea: 'docs/ideas',
        deliverable: 'docs/deliverables', improvement: 'docs/improvements', milestone: 'docs/milestones', iteration: 'docs/iterations',
        'test suite': 'docs/tests/suites', 'test case': 'docs/tests/cases',
      },
      stateKey: '', tagsKey: 'tags', doneValues: done, wipLimits: {}, columnPolicies: {}, stateColors: {},
      startedDateKey: '', finishedDateKey: '', startedStates: [], states: [], horizonKey: '', horizonValues: ['Now', 'Next', 'Later'],
      dependsOnKey: '', startKey: '', targetKey: '', deliverableStateKey: '', deliverableStates: [], deliverableDoneValues: done,
      testStateKey: '', testStates: [], testDoneValues: done, riskKey: '', riskValues: ['1 - High', '2 - Normal', '3 - Low'],
      priorityKey: '', priorityValues: ['1 - Must', '2 - Should', '3 - Could', "4 - Won't"], assigneeKey: '', iterationKey: '',
      iterationsOnTimeline: true, iterationBars: false, iterationGoalKey: '', releaseKey: '', releaseDateKey: 'target-date',
      iterationOpenStates: [], iterationResolvedStates: [], iterationLengthDays: 14, openIn: 'active',
    });
    expect(Object.keys(defaultSettings().columnPolicies)).toEqual([]);
    expect(Object.keys(defaultSettings().stateColors)).toEqual([]);
  });

  it('list every owned role in backlog-view order', () => {
    expect(ownedProperties({ ...defaultSettings(), stateKey: 'status' }).map(({ role, key }) => `${role}=${key}`)).toEqual([
      'parent=parent', 'order=order', 'type=type', 'state=status', 'startedDate=', 'finishedDate=', 'horizon=', 'start=', 'target=', 'risk=', 'priority=',
      'assignee=', 'deliverableState=', 'testState=', 'dependsOn=', 'iteration=', 'iterationGoal=', 'release=', 'tags=tags',
    ]);
  });
});

describe('view option readers', () => {
  const key = (value: unknown) => resolveSettings({ parentProperty: value }).parentKey;

  it.each([
    ['note.up', 'up'], ['  note.up  ', 'up'], ['up', 'up'], [' up ', 'up'], ['file.folder', 'parent'], ['formula.x', 'parent'], ['note.', 'note.'],
    ['other.up', 'other.up'], ['.up', '.up'], ['', 'parent'], ['   ', 'parent'], [5, 'parent'], [undefined, 'parent'],
  ])('reads the property id %j as the key %j', (value, expected) => {
    expect(key(value)).toBe(expected);
  });

  it('normalizes paths and folders like Obsidian', () => {
    expect([normalizePath('/'), normalizePath(''), normalizePath('a\u00a0b'), normalizePath('a\u202fb'), normalizePath('\\a\\\\b//')]).toEqual(['/', '/', 'a b', 'a b', 'a/b']);
    expect([vaultFolder(' \\docs/notes\\ '), vaultFolder('//'), vaultFolder('')]).toEqual(['docs/notes', '', '']);
  });

  it('reads WIP limits as whole numbers from 1, iteration lengths as positive whole days, and colours as names or hex codes', () => {
    const settings = resolveSettings({
      stateValues: 'A, B, C, D, E, F, Done', 'wipLimit.a': ' 2 ', 'wipLimit.b': '0', 'wipLimit.c': '1.5', 'wipLimit.d': '', 'wipLimit.e': 'x', 'wipLimit.f': '1', 'wipLimit.done': '4',
      'stateColor.a': '#A0B1C2', 'stateColor.b': '#abc', 'stateColor.c': 'x#aabbcc', 'stateColor.d': '#aabbccdd', 'stateColor.e': ' Red ', 'stateColor.f': '#gggggg', 'stateColor.done': 'red',
    });
    expect(settings.wipLimits).toEqual({ a: 2, f: 1 });
    expect(settings.stateColors).toEqual({ a: '#a0b1c2', e: 'red' });
    expect(['7', ' 7 ', '0', '-1', '', '   ', '7.5', 'x'].map(days => resolveSettings({ iterationLengthDays: days }).iterationLengthDays)).toEqual([7, 7, 14, 14, 14, 14, 14, 14]);
  });

  it('reads booleans only as booleans, the open mode, and clearable folders and lists', () => {
    expect(resolveSettings({ iterationsOnTimeline: false, iterationBars: true, showOutsideParents: false, showCounts: false, hierarchyOnly: false, inferFolderHierarchy: true }))
      .toMatchObject({ iterationsOnTimeline: false, iterationBars: true, showOutsideParents: false, showCounts: false, hierarchyOnly: false, folderHierarchy: true });
    expect(resolveSettings({ iterationBars: 'yes', showCounts: 0 })).toMatchObject({ iterationBars: false, showCounts: true });
    expect(['tab', 'split', 'window', ''].map(openIn => resolveSettings({ openIn }).openIn)).toEqual(['tab', 'split', 'active', 'active']);
    expect([resolveSettings({ resourceFolder: '' }).resourceFolder, resolveSettings({ resourceFolder: ' /res/ ' }).resourceFolder, resolveSettings({ homeFolder: 'work' }).resourceFolder])
      .toEqual(['', 'res', 'work/resources']);
    expect(resolveSettings({
      startedStates: 'Doing, doing, Review', horizonValues: 'Now, now', iterationOpenStates: 'Open, open', iterationResolvedStates: 'Done, DONE', priorityValues: 'P1,P1',
    })).toMatchObject({ startedStates: ['Doing', 'Review'], horizonValues: ['Now'], iterationOpenStates: ['Open'], iterationResolvedStates: ['Done'], priorityValues: ['P1'] });
  });
});

describe('secondary workflows', () => {
  const workflows = (view: ViewOptions) => {
    const settings = resolveSettings({ stateValues: 'Open, Doing, Done', doneValues: 'Done', ...view });
    return [settings.deliverableStates, settings.deliverableDoneValues, settings.testStates, settings.testDoneValues];
  };

  it('share the requirements workflow while unbound, and keep their own values once bound', () => {
    expect(workflows({})).toEqual([['Open', 'Doing', 'Done'], ['Done'], ['Open', 'Doing', 'Done'], ['Done']]);
    expect(workflows({ deliverableStateProperty: 'note.dstate', testStateProperty: 'note.tstate' })).toEqual([[], done, [], done]);
    expect(workflows({ deliverableStateValues: 'Draft, draft, Final', testStateValues: 'Planned', testDoneValues: 'Passed' })).toEqual([['Draft', 'Final'], ['Done'], ['Planned'], ['Passed']]);
    expect(workflows({ deliverableStateProperty: 'note.dstate', deliverableDoneValues: 'Final' })).toEqual([[], ['Final'], ['Open', 'Doing', 'Done'], ['Done']]);
  });

  it('colour the requirements states and the Deliverable states that are not done, once each', () => {
    const settings = resolveSettings({
      stateValues: 'Open, Doing, Done', deliverableStateValues: 'doing, Review, Final', deliverableDoneValues: 'Final',
      'stateColor.open': 'red', 'stateColor.doing': 'blue', 'stateColor.review': 'green', 'stateColor.final': 'pink', 'stateColor.done': 'cyan',
    });
    expect(settings.stateColors).toEqual({ open: 'red', doing: 'blue', review: 'green' });
  });
});

describe('workflow helpers', () => {
  const settings = { ...defaultSettings(), stateKey: 'status', testStateKey: 'tstate', states: ['Open'], deliverableStates: ['Draft'], deliverableDoneValues: ['Final'], testStates: ['Planned'], testDoneValues: ['Passed'], startedStates: ['Doing'] };

  it('names each type\'s workflow, its key and its values', () => {
    expect([workflowOf('deliverable', LEVELS), workflowOf('Test case', TEST_LEVELS), workflowOf('Task', TEST_LEVELS), workflowOf('PBI', LEVELS), workflowOf(null, LEVELS)])
      .toEqual(['deliverable', 'test', 'test', 'requirements', 'requirements']);
    expect([workflowKey(settings, 'deliverable'), workflowKey(settings, 'test'), workflowKey(settings, 'requirements')]).toEqual(['status', 'tstate', 'status']);
    expect(workflowKey({ ...settings, deliverableStateKey: 'dstate', testStateKey: '' }, 'deliverable')).toBe('dstate');
    expect(workflowKey({ ...settings, testStateKey: '' }, 'test')).toBe('status');
    expect([workflowValues(settings, 'deliverable'), workflowValues(settings, 'test'), workflowValues(settings, 'requirements')]).toEqual([['Draft', 'Final'], ['Planned', 'Passed'], ['Open', ...done]]);
  });

  it('matches done and started values case-insensitively and offers menu values', () => {
    expect([isDoneValue(settings, 'closed'), isDoneValue(settings, 'Open'), isDoneValue(settings, null)]).toEqual([true, false, false]);
    expect([isStartedValue(settings, 'doing'), isStartedValue(settings, 'Open'), isStartedValue(settings, null)]).toEqual([true, false, false]);
    expect(menuValues(['A'], ['Done'], ['x'])).toEqual(['A']);
    expect(menuValues([], ['Done', 'Closed'], ['Open', 'closed'])).toEqual(['Open', 'closed']);
    expect(menuValues([], ['Done', 'Closed'], ['Open'])).toEqual(['Open', 'Done']);
    expect(menuValues([], [], ['Open'])).toEqual(['Open']);
  });

  it('reports roles sharing a key unless all of them are workflow states', () => {
    expect(configProblems(resolveSettings({ stateProperty: 'note.x', horizonProperty: 'note.x' }))).toEqual(['The properties state, horizon all use the key "x".']);
    expect(configProblems(resolveSettings({ stateProperty: 'note.s', deliverableStateProperty: 'note.s', testStateProperty: 'note.s' }))).toEqual([]);
    expect(configProblems(resolveSettings({ typeProperty: 'note.parent', tagsProperty: 'note.t', riskProperty: 'note.t' }))).toEqual([
      'The properties parent, type all use the key "parent".', 'The properties risk, tags all use the key "t".',
    ]);
  });
});

describe('release view options', () => {
  it('apply defaults, clear hierarchy keys and folders, trim values and keep released values as written', () => {
    expect(resolveReleaseSettings({})).toEqual({
      parentKey: 'parent', orderKey: 'order', typeKey: 'type', membershipKey: '', versionKey: '', targetDateKey: '', statusKey: '', releasedDateKey: '', descriptionKey: '',
      estimateKey: '', capacityKey: '', capacityUnit: '', dependsOnKey: '', riskKey: '', criticalRiskValues: [], addressedRiskValues: [], statusValues: [], releasedValues: [],
      releasedTransition: '', notesFolder: '', folder: 'docs/releases',
    });
    expect(resolveReleaseSettings({
      parentProperty: '', orderProperty: 'note.rank', releaseFolder: ' /rel/ ', capacityUnit: ' pts ', releasedTransitionValue: ' Shipped ', releaseStatusValues: 'Open, open, Shipped',
      releasedStatusValues: 'Shipped, shipped', criticalRiskValues: 'High, high', addressedRiskValues: 'Ok, OK',
    })).toMatchObject({ parentKey: '', orderKey: 'rank', folder: 'rel', capacityUnit: 'pts', releasedTransition: 'Shipped', statusValues: ['Open', 'Shipped'],
      releasedValues: ['Shipped', 'shipped'], criticalRiskValues: ['High'], addressedRiskValues: ['Ok'] });
    expect(resolveReleaseSettings({ releaseFolder: '' }).folder).toBe('');
  });

  it('report shared release keys by role, a released date on the target key and a transition outside the released values', () => {
    const problems = (view: ViewOptions) => releaseNoteProblems(resolveReleaseSettings(view));
    expect(problems({ typeProperty: 'note.parent', versionProperty: 'note.v', descriptionProperty: 'note.v', capacityProperty: 'note.order' })).toEqual([
      'The release properties type, parent all use the key "parent".', 'The release properties order, capacity all use the key "order".',
      'The release properties version, description all use the key "v".',
    ]);
    expect(problems({ targetDateProperty: 'note.d', releasedDateProperty: 'note.d', releaseStatusProperty: 'note.d' })).toEqual([
      'The release properties target-date, release status, released date all use the key "d".', 'The released date and the target date share the key "d".',
    ]);
    expect(problems({ releasedTransitionValue: 'Shipped' })).toEqual([]);
    expect(problems({ releasedStatusValues: 'Shipped' })).toEqual([]);
    expect(problems({ releasedTransitionValue: 'shipped', releasedStatusValues: 'Live, Shipped' })).toEqual([]);
    expect(problems({ releasedTransitionValue: 'Gone', releasedStatusValues: 'Live, Shipped' })).toEqual(['The released transition value "Gone" is not one of the released status values.']);
  });

  it('report a membership key that another plan or release role owns', () => {
    const plan = resolveSettings({ stateProperty: 'note.status', releaseProperty: 'note.release' });
    const collision = (view: ViewOptions) => membershipCollision(resolveReleaseSettings(view), plan);
    expect(collision({ membershipProperty: 'note.release' })).toBeNull();
    expect(collision({ membershipProperty: 'note.rel' })).toBeNull();
    expect(collision({})).toBeNull();
    expect(collision({ membershipProperty: 'note.v', versionProperty: 'note.v' })).toBe('The release membership key "v" is also the version property.');
    expect(collision({ membershipProperty: 'note.order' })).toBe('The release membership key "order" is also the order property.');
    expect(collision({ membershipProperty: 'note.tags' })).toBe('The release membership key "tags" is also the tags property.');
  });
});
