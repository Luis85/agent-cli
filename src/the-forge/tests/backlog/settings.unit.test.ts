import { describe, expect, it } from 'vitest';
import { configProblems, defaultSettings, folderForType } from '../../src/plugins/backlog/domain/settings.ts';
import {
  membershipCollision, normalizePath, releaseNoteProblems, resolveReleaseSettings, resolveSettings, vaultFolder,
} from '../../src/plugins/backlog/domain/settings-resolve.ts';

// The `product-backlog` and `product-release` views of backlog-view's own docs/Product Backlog.base (fb813df).
const backlogView = {
  type: 'product-backlog', name: 'Backlog', homeFolder: 'docs', stateProperty: 'note.status', stateValues: 'Open, Active, Done',
  doneValues: 'Done, Dropped', targetProperty: 'note.due', startProperty: 'note.start', horizonProperty: 'note.horizon',
  deliverableStateValues: 'Open, Active, Done', startedDateProperty: 'note.started', finishedDateProperty: 'note.finished', openIn: 'split',
  riskProperty: 'note.risk', priorityProperty: 'note.priority', priorityValues: 'P1, P2, P3', assigneeProperty: 'note.assignee',
  dependsOnProperty: 'note.dependsOn', 'typeFolder.absence': 'docs/absences', iterationProperty: 'note.iteration', iterationGoalProperty: 'note.goal', releaseProperty: 'note.release',
};
const releaseView = {
  type: 'product-release', name: 'Release Management', membershipProperty: 'note.release', versionProperty: 'note.version', targetDateProperty: 'note.target-date',
  releaseStatusProperty: 'note.status', stateProperty: 'note.status', deliverableStateProperty: 'note.status', releasedDateProperty: 'note.released',
  descriptionProperty: 'note.description', estimateProperty: 'note.effort', capacityProperty: 'note.capacity', capacityUnit: 'points',
  releaseNotesFolder: 'docs/release-notes', releasedStatusValues: 'Released', releasedTransitionValue: 'Released', dependsOnProperty: 'note.dependsOn', riskProperty: 'note.risk',
};

describe('backlog view settings', () => {
  it('resolves the plugin\'s own docs base exactly', () => {
    const settings = resolveSettings(backlogView);
    expect(settings).toMatchObject({
      parentKey: 'parent', orderKey: 'order', typeKey: 'type', stateKey: 'status', states: ['Open', 'Active', 'Done'], doneValues: ['Done', 'Dropped'],
      targetKey: 'due', startKey: 'start', horizonKey: 'horizon', horizonValues: ['Now', 'Next', 'Later'], startedDateKey: 'started', finishedDateKey: 'finished',
      startedStates: [], riskKey: 'risk', riskValues: ['1 - High', '2 - Normal', '3 - Low'], priorityKey: 'priority', priorityValues: ['P1', 'P2', 'P3'],
      assigneeKey: 'assignee', dependsOnKey: 'dependsOn', iterationKey: 'iteration', iterationGoalKey: 'goal', releaseKey: 'release', releaseDateKey: 'target-date',
      tagsKey: 'tags', hierarchyOnly: true, showOutsideParents: true, folderHierarchy: false, iterationLengthDays: 14, openIn: 'split',
      // The Deliverable workflow shares the state key, so its done values follow the effective done values.
      deliverableStateKey: '', deliverableStates: ['Open', 'Active', 'Done'], deliverableDoneValues: ['Done', 'Dropped'],
      testStateKey: '', testStates: ['Open', 'Active', 'Done'], testDoneValues: ['Done', 'Dropped'],
    });
    expect(folderForType('epic', settings)).toBe('docs/requirements');
    expect(folderForType('Task', settings)).toBe('docs/tasks');
    expect(folderForType('Test case', settings)).toBe('docs/tests/cases');
    expect(folderForType('Absence', settings)).toBe('docs/absences');
    expect(folderForType('Release', settings)).toBeNull();
    expect(settings.resourceFolder).toBe('docs/resources');
    expect(configProblems(settings)).toEqual([]);
  });

  it('applies defaults, clearable options, comma lists, booleans, limits and colours', () => {
    expect(resolveSettings({})).toEqual(defaultSettings());
    const settings = resolveSettings({
      homeFolder: ' /work\\backlog/ ', tagsProperty: '', horizonValues: '', riskValues: 'Low, low, High', 'typeFolder.task': '',
      hierarchyOnly: false, inferFolderHierarchy: 'yes', stateProperty: 'status', stateValues: 'Todo, Doing, Done, doing',
      'wipLimit.doing': '3', 'wipLimit.done': '2', 'wipLimit.todo': '0', 'columnPolicy.todo': ' Ready when sized ', 'stateColor.doing': 'Cyan', 'stateColor.todo': 'mauve',
      iterationLengthDays: '7.5', releaseDateProperty: '', parentProperty: 'file.folder', orderProperty: 'note.rank',
    });
    expect(settings).toMatchObject({
      homeFolder: 'work/backlog', tagsKey: '', horizonValues: [], riskValues: ['Low', 'High'], hierarchyOnly: false, folderHierarchy: false,
      stateKey: 'status', states: ['Todo', 'Doing', 'Done'], wipLimits: { doing: 3 }, columnPolicies: { todo: 'Ready when sized' }, stateColors: { doing: 'cyan' },
      iterationLengthDays: 14, releaseDateKey: '', parentKey: 'parent', orderKey: 'rank',
    });
    expect(folderForType('Task', settings)).toBeNull();
    expect(folderForType('Bug', settings)).toBe('work/backlog/bugs');
    expect(vaultFolder('  ')).toBe('');
    expect(normalizePath('a//b\\c/')).toBe('a/b/c');
  });

  it('reports roles that share one key, except the workflow states', () => {
    expect(configProblems(resolveSettings({ stateProperty: 'note.status', deliverableStateProperty: 'note.status' }))).toEqual([]);
    expect(configProblems(resolveSettings({ horizonProperty: 'note.order' }))).toEqual(['The properties order, horizon all use the key "order".']);
    // The tags role yields to the hierarchy roles instead of colliding.
    expect(resolveSettings({ tagsProperty: 'note.type' }).tagsKey).toBe('');
  });
});

describe('release view settings', () => {
  it('resolves the release view and its problems', () => {
    const settings = resolveReleaseSettings(releaseView);
    expect(settings).toEqual({
      parentKey: 'parent', orderKey: 'order', typeKey: 'type', membershipKey: 'release', versionKey: 'version', targetDateKey: 'target-date', statusKey: 'status',
      releasedDateKey: 'released', descriptionKey: 'description', estimateKey: 'effort', capacityKey: 'capacity', capacityUnit: 'points', dependsOnKey: 'dependsOn',
      riskKey: 'risk', criticalRiskValues: [], addressedRiskValues: [], statusValues: [], releasedValues: ['Released'], releasedTransition: 'Released',
      notesFolder: 'docs/release-notes', folder: 'docs/releases',
    });
    expect(releaseNoteProblems(settings)).toEqual([]);
    expect(membershipCollision(settings, resolveSettings(backlogView))).toBeNull();
    const broken = resolveReleaseSettings({ ...releaseView, releasedDateProperty: 'note.target-date', releasedTransitionValue: 'Shipped', typeProperty: '' });
    expect(broken.typeKey).toBe('');
    expect(releaseNoteProblems(broken)).toEqual([
      'The release properties target-date, released date all use the key "target-date".',
      'The released date and the target date share the key "target-date".',
      'The released transition value "Shipped" is not one of the released status values.',
    ]);
    expect(membershipCollision(resolveReleaseSettings({ membershipProperty: 'note.status' }), resolveSettings(backlogView))).toBe('The release membership key "status" is also the state property.');
  });
});
