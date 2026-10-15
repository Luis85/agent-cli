import { describe, expect, it } from 'vitest';
import {
  ALL_TYPES, EXTRA_TYPE_RANK, FILED_TYPES, FOLDER_OPTION_TYPES, LEVELS, TEST_LEVELS, byName, canonicalType, childLevelIndex, defaultResourceFolder, defaultTypeFolder,
  drawsAsPoint, inCatalog, isAbsenceType, isDeliverableType, isExtraType, isIterationType, isMarkerType, isReleaseType, isResourceType, keepsProjection,
  ladderFor, mayHoldField, placementEnds, sameType, typeFolderKey, type HeldField,
} from '../../src/plugins/backlog/domain/vocabulary.ts';

describe('the type vocabulary', () => {
  it('lists every type in vocabulary order, files all but releases and folders absences too', () => {
    expect(ALL_TYPES).toStrictEqual(['Epic', 'Feature', 'PBI', 'Task', 'Issue', 'Bug', 'Idea', 'Deliverable', 'Improvement', 'Milestone', 'Iteration', 'Release', 'Test suite', 'Test case']);
    expect(FILED_TYPES).toStrictEqual(ALL_TYPES.filter(type => type !== 'Release'));
    expect(FOLDER_OPTION_TYPES).toStrictEqual([...FILED_TYPES, 'Absence']);
    expect(EXTRA_TYPE_RANK).toBe(2);
  });

  it.each<[string, string]>([['resource', 'Resource'], ['ABSENCE', 'Absence'], ['milestone', 'Milestone'], ['Spike', 'Spike']])('spells %s as %s', (name, canonical) => {
    expect(canonicalType(name)).toBe(canonical);
  });

  it('classifies types case-insensitively and never null', () => {
    const kinds = (type: string | null) => [isExtraType, isMarkerType, isIterationType, isReleaseType, isResourceType, isAbsenceType, isDeliverableType].map(test => test(type));
    expect(kinds('bug')).toStrictEqual([true, false, false, false, false, false, false]);
    expect(kinds('deliverable')).toStrictEqual([true, false, false, false, false, false, true]);
    expect(kinds('MILESTONE')).toStrictEqual([false, true, false, false, false, false, false]);
    expect(kinds('iteration')).toStrictEqual([false, true, true, false, false, false, false]);
    expect(kinds('release')).toStrictEqual([false, true, false, true, false, false, false]);
    expect(kinds('resource')).toStrictEqual([false, false, false, false, true, false, false]);
    expect(kinds('absence')).toStrictEqual([false, false, false, false, false, true, false]);
    expect(kinds(null)).toStrictEqual([false, false, false, false, false, false, false]);
    expect([sameType('pbi', 'PBI'), sameType(null, 'PBI'), sameType('Bug', 'PBI')]).toStrictEqual([true, false, false]);
  });
});

describe('folders', () => {
  it('files types in their subfolder of the home folder', () => {
    expect(defaultTypeFolder('Test case')).toBe('docs/tests/cases');
    expect(defaultTypeFolder('pbi', 'work')).toBe('work/requirements');
    expect(defaultTypeFolder('Iteration', '')).toBe('iterations');
    expect(defaultTypeFolder('Spike')).toBe('');
    expect(defaultResourceFolder()).toBe('docs/resources');
    expect(defaultResourceFolder('work')).toBe('work/resources');
    expect(defaultResourceFolder('')).toBe('resources');
    expect(typeFolderKey('Test Case')).toBe('typeFolder.test case');
  });

  it.each<[string, string]>([
    ['Epic', 'requirements'], ['Feature', 'requirements'], ['PBI', 'requirements'], ['Task', 'tasks'], ['Issue', 'issues'], ['Bug', 'bugs'], ['Idea', 'ideas'],
    ['Deliverable', 'deliverables'], ['Improvement', 'improvements'], ['Milestone', 'milestones'], ['Iteration', 'iterations'], ['Release', 'releases'],
    ['Test suite', 'tests/suites'], ['Test case', 'tests/cases'],
  ])('files a %s in docs/%s', (type, folder) => {
    expect(defaultTypeFolder(type)).toBe(`docs/${folder}`);
  });

  it('reads tables by lowercased name, never off the prototype', () => {
    const table = { pbi: 'x' };
    expect([byName(table, 'PBI'), byName(table, null), byName(table, 'toString'), byName(table, 'Bug')]).toStrictEqual(['x', undefined, undefined, undefined]);
  });
});

describe('ladders', () => {
  it('puts test types on the test ladder and lets a Task or untyped note follow its parent', () => {
    expect(ladderFor('test SUITE', null)).toBe(TEST_LEVELS);
    expect(ladderFor('Task', null)).toBe(LEVELS);
    expect(ladderFor(null, TEST_LEVELS)).toBe(TEST_LEVELS);
    expect(ladderFor('Bug', TEST_LEVELS)).toBe(LEVELS);
    expect(ladderFor('Spike', null)).toBe(LEVELS);
    expect([inCatalog({ ladder: TEST_LEVELS }), inCatalog({ ladder: LEVELS }), inCatalog({ ladder: [...TEST_LEVELS] })]).toStrictEqual([true, false, false]);
  });

  it('keeps an item on its projection under its new parent', () => {
    expect(keepsProjection({ typeName: 'Task', ladder: TEST_LEVELS }, { ladder: TEST_LEVELS })).toBe(true);
    expect(keepsProjection({ typeName: 'Task', ladder: LEVELS }, null)).toBe(true);
    expect(keepsProjection({ typeName: 'Task', ladder: TEST_LEVELS }, null)).toBe(false);
  });

  it('places a child one rung below its parent, clamped to the parent\'s ladder or the one given', () => {
    const at = (effectiveLevelIndex: number, ladder: string[]) => ({ levelIndex: effectiveLevelIndex, effectiveLevelIndex, ladder, typeName: null });
    expect(childLevelIndex(at(2, TEST_LEVELS))).toBe(2);
    expect(childLevelIndex(at(1, TEST_LEVELS))).toBe(2);
    expect(childLevelIndex(at(2, LEVELS))).toBe(3);
    expect(childLevelIndex(at(2, LEVELS), TEST_LEVELS)).toBe(2);
    expect(childLevelIndex(null, TEST_LEVELS)).toBe(0);
  });
});

describe('fields a type may hold', () => {
  it('refuses only release links on markers and test items, and planning fields on releases', () => {
    const fields: HeldField[] = ['release', 'start', 'target', 'horizon', 'iteration', 'iterationGoal'];
    const holds = (type: string | null, bars = false) => fields.map(field => mayHoldField(type, field, bars));
    expect(holds('Milestone')).toStrictEqual([false, true, true, true, true, true]);
    expect(holds('Iteration', true)).toStrictEqual([false, true, true, true, true, true]);
    expect(holds('Test suite')).toStrictEqual([false, true, true, true, true, true]);
    expect(holds('PBI')).toStrictEqual([true, true, true, true, true, true]);
    expect(holds(null)).toStrictEqual([true, true, true, true, true, true]);
    expect(holds('Release', true)).toStrictEqual([false, false, false, false, false, false]);
  });

  it('draws markers other than releases as points, and iterations as bars when asked', () => {
    expect([drawsAsPoint('Milestone', true), drawsAsPoint('Iteration', false), drawsAsPoint('Iteration', true), drawsAsPoint('Release', false), drawsAsPoint(null, false)])
      .toStrictEqual([true, true, false, false, false]);
    expect(placementEnds('PBI', false)).toStrictEqual(['start', 'target']);
    expect(placementEnds(null, false)).toStrictEqual(['start', 'target']);
  });
});
