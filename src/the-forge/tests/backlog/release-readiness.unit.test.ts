import { describe, expect, it } from 'vitest';
import type { NoteSource } from '../../src/plugins/backlog/domain/items.ts';
import { buildModel } from '../../src/plugins/backlog/domain/model.ts';
import { estimateValue, generatedSource, releaseNotesContent, releaseNotesPath, releaseNotesSource, releaseReadiness } from '../../src/plugins/backlog/domain/releases.ts';
import { resolveReleaseSettings, resolveSettings, type ViewOptions } from '../../src/plugins/backlog/domain/settings-resolve.ts';

const notes: Record<string, Record<string, unknown>> = {
  'w/Done.md': { type: 'PBI', status: 'Done', effort: 0.1, risk: ['High', 'Mitigated'] },
  'w/Open.md': { type: 'PBI', status: 'Open', effort: '0.2', risk: 'high' },
  'w/Big.md': { type: 'PBI', status: 'Open', effort: 'big', dependsOn: [5, null], risk: { level: 'High' } },
  'w/Waits.md': { type: 'PBI', status: 'Open', effort: 0, dependsOn: '[[Open]]', risk: 'Low' },
  'w/Ready.md': { type: 'PBI', status: 'Open', effort: -1, dependsOn: '[[Done]]', risk: null },
  'w/Broken.md': { type: 'PBI', status: 'Done', effort: 2, dependsOn: '[[Ghost]]' },
  'w/Doc.md': { type: 'Deliverable', dstate: 'Done', effort: 1 },
  'w/Nulls.md': { type: 'PBI', status: 'Open', dependsOn: [null, '[[Done]]'], risk: ['Accepted', 'Critical'] },
  'w/Critical.md': { type: 'PBI', status: 'Open', risk: 'critical' },
  'w/Tested.md': { type: 'PBI', status: 'Open', dependsOn: '[[Passed]]' }, 'w/Untested.md': { type: 'PBI', status: 'Open', dependsOn: '[[Pending]]' },
  't/Suite.md': { type: 'Test suite' }, 't/Passed.md': { type: 'Test case', parent: '[[Suite]]', status: 'Open', tstate: 'Done' },
  't/Pending.md': { type: 'Test case', parent: '[[Suite]]', status: 'Done', tstate: 'Open' },
  'w/Tiny.md': { type: 'PBI', status: 'Done', effort: 1.5e-10 }, 'w/Many.md': { type: 'PBI', status: 'Done', effort: 12.25 }, 'w/Huge.md': { type: 'PBI', effort: 3e21 },
};
const source: NoteSource = {
  frontmatter: path => notes[path],
  frontmatterLinks: () => [],
  resolve: linkpath => Object.keys(notes).find(path => path.slice(path.lastIndexOf('/') + 1, -3) === linkpath) ?? null,
};
const allRelease = { estimateProperty: 'note.effort', dependsOnProperty: 'note.dependsOn', riskProperty: 'note.risk', criticalRiskValues: 'High', addressedRiskValues: 'Mitigated' };
function readiness(titles: string[], release: ViewOptions = allRelease, plan: ViewOptions = { stateProperty: 'note.status' }) {
  const settings = resolveSettings({ dependsOnProperty: 'note.dependsOn', ...plan });
  const model = buildModel(source, Object.keys(notes), settings, path => path in notes);
  return releaseReadiness(source, titles.map(title => model.byPath.get(`w/${title}.md`)!), resolveReleaseSettings(release), settings);
}
const verdicts = (result: ReturnType<typeof readiness>) => result.criteria.map(criterion => criterion.verdict);

describe('release readiness', () => {
  it('judges estimates, blockers and critical risks over the members, counting unreadable values', () => {
    expect(readiness(['Done', 'Open', 'Big', 'Waits', 'Ready', 'Broken'])).toEqual({
      members: 6, unestimated: 2, estimatedEffort: 2.3, completedEffort: 2.1,
      criteria: [
        { key: 'estimated', verdict: 'partly', cleared: 4, outstanding: 2, unreadable: 0, outstandingPaths: ['w/Big.md', 'w/Ready.md'] },
        { key: 'blocked', verdict: 'partly', cleared: 3, outstanding: 3, unreadable: 2, outstandingPaths: ['w/Big.md', 'w/Waits.md', 'w/Broken.md'] },
        { key: 'risk', verdict: 'partly', cleared: 4, outstanding: 2, unreadable: 1, outstandingPaths: ['w/Open.md', 'w/Big.md'] },
      ],
    });
  });

  it('reads satisfied, not and empty verdicts', () => {
    expect(verdicts(readiness(['Done']))).toEqual(['satisfied', 'satisfied', 'satisfied']);
    expect(verdicts(readiness(['Big']))).toEqual(['not', 'not', 'not']);
    expect(readiness([])).toEqual({
      members: 0, unestimated: 0, estimatedEffort: 0, completedEffort: 0,
      criteria: ['estimated', 'blocked', 'risk'].map(key => ({ key, verdict: 'empty', cleared: 0, outstanding: 0, unreadable: 0, outstandingPaths: [] })),
    });
  });

  it('switches each criterion off while its properties or value lists are unbound', () => {
    const off = (key: string) => ({ key, verdict: 'unconfigured', cleared: null, outstanding: null, unreadable: null, outstandingPaths: null });
    expect(readiness(['Done'], {})).toEqual({ members: 1, unestimated: null, estimatedEffort: null, completedEffort: null, criteria: [off('estimated'), off('blocked'), off('risk')] });
    expect(verdicts(readiness(['Done'], { ...allRelease, criticalRiskValues: '' }))).toEqual(['satisfied', 'satisfied', 'unconfigured']);
    expect(verdicts(readiness(['Done'], { ...allRelease, addressedRiskValues: '' }))).toEqual(['satisfied', 'satisfied', 'unconfigured']);
    expect(verdicts(readiness(['Done'], { ...allRelease, riskProperty: '' }))).toEqual(['satisfied', 'satisfied', 'unconfigured']);
    // Without any workflow that clears, a prerequisite's state cannot be read.
    expect(verdicts(readiness(['Done'], allRelease, {}))).toEqual(['satisfied', 'unconfigured', 'satisfied']);
  });

  it('counts a prerequisite whose workflow cannot clear as unreadable, and completed effort only when every estimated member can clear', () => {
    const deliverableOnly = { deliverableStateProperty: 'note.dstate' };
    expect(readiness(['Ready'], allRelease, deliverableOnly).criteria[1]).toEqual({ key: 'blocked', verdict: 'not', cleared: 0, outstanding: 1, unreadable: 1, outstandingPaths: ['w/Ready.md'] });
    expect(readiness(['Done', 'Doc'], allRelease, deliverableOnly)).toMatchObject({ estimatedEffort: 1.1, completedEffort: null });
    expect(readiness(['Doc'], allRelease, deliverableOnly)).toMatchObject({ estimatedEffort: 1, completedEffort: 1 });
    expect(readiness(['Open', 'Doc'], allRelease, {})).toMatchObject({ estimatedEffort: 1.2, completedEffort: null });
  });

  it('ignores empty prerequisite entries, matches any critical or addressed risk value, and reads test prerequisites in their own workflow', () => {
    const several = { ...allRelease, criticalRiskValues: 'High, Critical', addressedRiskValues: 'Mitigated, Accepted' };
    expect(readiness(['Nulls', 'Critical'], several).criteria.map(({ key, outstandingPaths }) => [key, outstandingPaths])).toEqual([
      ['estimated', ['w/Nulls.md', 'w/Critical.md']], ['blocked', []], ['risk', ['w/Critical.md']],
    ]);
    expect(readiness(['Tested', 'Untested'], allRelease, { stateProperty: 'note.status', testStateProperty: 'note.tstate' }).criteria[1])
      .toEqual({ key: 'blocked', verdict: 'partly', cleared: 1, outstanding: 1, unreadable: 0, outstandingPaths: ['w/Untested.md'] });
  });

  it('totals estimates exactly, whatever their exponent', () => {
    expect(readiness(['Tiny', 'Many'])).toMatchObject({ estimatedEffort: 12.25000000015, completedEffort: 12.25000000015 });
    expect(readiness(['Huge', 'Many'])).toMatchObject({ estimatedEffort: 3e21, completedEffort: 12.25 });
    expect([estimateValue(' 2.5 '), estimateValue('  '), estimateValue(-0.5), estimateValue('1e3'), estimateValue(null), estimateValue(NaN)])
      .toEqual([2.5, null, null, 1000, null, null]);
  });
});

describe('release notes source marker', () => {
  const marker = (source: string) => releaseNotesContent('X', [], source);

  it('escapes the source parts and round-trips line breaks and comment delimiters', () => {
    expect(releaseNotesSource('a%b.base', 'View', 'r/1.0.md')).toBe('a%25b.base › View › r/1.0.md');
    expect(marker('a\r\nb')).toContain('from "a%0D%0Ab"');
    expect(generatedSource(marker('a\r\nb'))).toBe('a\r\nb');
    expect(generatedSource(marker('100%-->'))).toBe('100%-->');
  });

  it('reads the marker from the first line only, with trailing spaces, and rejects foreign or altered markers', () => {
    const first = marker('s').split('\n')[0]!;
    expect(generatedSource(first)).toBe('s');
    expect(generatedSource(`${first}  \nbody`)).toBe('s');
    expect(generatedSource(`\n${first}`)).toBeNull();
    expect(generatedSource(` ${first}`)).toBeNull();
    expect(generatedSource(first.replace('Rewritten', 'Kept'))).toBeNull();
    expect(generatedSource(first.replace('Generated', 'Written'))).toBeNull();
    expect(generatedSource(first.replace('"s"', '"%2Ds"'))).toBeNull();
    expect(generatedSource(first.replace('"s"', '"a-b"'))).toBe('a-b');
  });

  it('places notes in the normalized notes folder', () => {
    expect(releaseNotesPath(' /docs\\notes/ ', '2.0')).toBe('docs/notes/2.0 release notes.md');
  });
});
