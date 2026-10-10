import { describe, expect, it } from 'vitest';
import type { NoteSource } from '../../src/plugins/backlog/domain/items.ts';
import { buildModel } from '../../src/plugins/backlog/domain/model.ts';
import {
  estimateValue, generatedSource, releaseIndex, releaseNotesContent, releaseNotesPath, releaseNotesSource, releaseReadiness, scopeRows, membershipTarget,
} from '../../src/plugins/backlog/domain/releases.ts';
import { resolveReleaseSettings, resolveSettings } from '../../src/plugins/backlog/domain/settings-resolve.ts';

/** An in-memory vault: frontmatter by path, wikilinks resolved by basename. */
function vault(notes: Record<string, Record<string, unknown>>): NoteSource {
  const resolve = (linkpath: string) => Object.keys(notes).find(path => path.slice(path.lastIndexOf('/') + 1, -3) === linkpath) ?? null;
  return {
    frontmatter: path => notes[path],
    frontmatterLinks: path => Object.entries(notes[path] ?? {}).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item, index) => [`${key}.${index}`, item]) : [[key, value]]))
      .flatMap(([key, value]) => (typeof value === 'string' && /^\[\[.+\]\]$/.test(value) ? [{ key: key as string, link: value.slice(2, -2) }] : [])),
    resolve,
  };
}

const notes = {
  'r/1.0.md': { type: 'Release', order: 1, 'target-date': '2026-10-01', status: 'Open', capacity: 20 },
  'r/0.9.md': { type: 'Release', order: 2, 'target-date': '2026-09-01', released: '2026-09-03' },
  'w/Epic.md': { type: 'Epic', order: 10, status: 'Open' },
  'w/Story.md': { type: 'PBI', parent: '[[Epic]]', order: 20, status: 'Done', release: '[[1.0]]', effort: 3, risk: 'High' },
  'w/Fix.md': { type: 'Bug', parent: '[[Epic]]', order: 30, status: 'Open', release: '[[1.0]]', effort: '2.5', dependsOn: ['[[Story]]', '[[Missing]]'], risk: ['High', 'Mitigated'] },
  'w/Stray.md': { type: 'Task', order: 40, release: ['[[1.0]]', '[[0.9]]'] },
  'w/Wrong.md': { type: 'Task', order: 50, release: '[[Epic]]' },
  'w/Doc.md': { type: 'Deliverable', order: 60, status: 'Draft', release: '[[1.0]]', effort: 'big' },
  'm/Gate.md': { type: 'Milestone', order: 70, release: '[[1.0]]' },
};
const source = vault(notes);
const plan = resolveSettings({ stateProperty: 'note.status', dependsOnProperty: 'note.dependsOn', releaseProperty: 'note.release' });
const release = resolveReleaseSettings({
  membershipProperty: 'note.release', targetDateProperty: 'note.target-date', releasedDateProperty: 'note.released', releaseStatusProperty: 'note.status',
  estimateProperty: 'note.effort', capacityProperty: 'note.capacity', dependsOnProperty: 'note.dependsOn', riskProperty: 'note.risk',
  criticalRiskValues: 'High', addressedRiskValues: 'Mitigated', releaseNotesFolder: 'docs/notes/',
});
const model = buildModel(source, Object.keys(notes), plan, path => path in notes);
const today = { year: 2026, month: 10, day: 5 };

describe('release membership and index', () => {
  it('resolves exactly one link to a Release and reports every other membership as unresolved', () => {
    const paths = new Set(model.releases.map(item => item.path));
    const of = (path: string) => membershipTarget(source, model.byPath.get(path)!, paths, release);
    expect(of('w/Story.md')).toBe('r/1.0.md');
    expect(of('w/Epic.md')).toBeNull();
    expect(of('w/Stray.md')).toBe('unresolved');
    expect(of('w/Wrong.md')).toBe('unresolved');
    expect(of('m/Gate.md')).toBe('unresolved');
    const index = releaseIndex(source, model, release, plan, today);
    expect(index.unresolved.map(item => item.path)).toEqual(['w/Stray.md', 'w/Wrong.md', 'm/Gate.md']);
    expect(index.rows.map(row => [row.name, row.shipped, row.overdue, row.members.value, row.done.value, row.daysToTarget, row.slip])).toEqual([
      ['1.0', false, true, 3, 1, -4, null],
      ['0.9', true, false, 0, 0, -34, 2],
    ]);
  });
});

describe('readiness', () => {
  it('reports estimated, blocked and risk criteria over the direct members', () => {
    const paths = new Set(model.releases.map(item => item.path));
    const rows = scopeRows(model, item => membershipTarget(source, item, paths, release) === 'r/1.0.md');
    expect(rows.map(row => [row.item.title, row.depth, row.context])).toEqual([['Epic', 0, true], ['Story', 1, false], ['Fix', 1, false], ['Doc', 0, false]]);
    const result = releaseReadiness(source, rows.filter(row => !row.context).map(row => row.item), release, plan);
    expect(result).toEqual({
      members: 3, unestimated: 1, estimatedEffort: 5.5, completedEffort: 3,
      criteria: [
        { key: 'estimated', verdict: 'partly', cleared: 2, outstanding: 1, unreadable: 0, outstandingPaths: ['w/Doc.md'] },
        { key: 'blocked', verdict: 'partly', cleared: 2, outstanding: 1, unreadable: 1, outstandingPaths: ['w/Fix.md'] },
        { key: 'risk', verdict: 'partly', cleared: 2, outstanding: 1, unreadable: 0, outstandingPaths: ['w/Story.md'] },
      ],
    });
    expect(releaseReadiness(source, [], resolveReleaseSettings({}), plan).criteria.map(criterion => criterion.verdict)).toEqual(['unconfigured', 'unconfigured', 'unconfigured']);
    expect([estimateValue(0), estimateValue('1.5'), estimateValue(-1), estimateValue(''), estimateValue('x'), estimateValue(Infinity)]).toEqual([0, 1.5, null, null, null, null]);
  });
});

describe('release notes', () => {
  it('writes the plugin\'s marker, headings and type groups byte for byte', () => {
    const paths = new Set(model.releases.map(item => item.path));
    const rows = scopeRows(model, item => membershipTarget(source, item, paths, release) === 'r/1.0.md');
    const source0 = releaseNotesSource('docs/Product Backlog.base', 'Release › Management', 'r/1.0.md');
    expect(source0).toBe('docs/Product Backlog.base › Release %E2%80%BA Management › r/1.0.md');
    const text = releaseNotesContent('1.0', rows, source0);
    expect(text).toBe([
      '<!-- Generated by the Product Backlog view from "docs/Product Backlog.base › Release %25E2%2580%25BA Management › r/1.0.md". Rewritten in full whenever it is regenerated. -->',
      '', '# 1.0', '', 'This file is generated. Edits to it do not survive the next regeneration.', '',
      'It lists this release’s members, as its scope tree draws them.', '',
      '## PBI', '', '- Story', '', '## Bug', '', '- Fix', '', '## Deliverable', '', '- Doc', '',
    ].join('\n'));
    expect(generatedSource(text)).toBe(source0);
    expect(generatedSource(`﻿${text.replace('\n', '\r\n')}`)).toBe(source0);
    expect(generatedSource('# Hand-written notes\n')).toBeNull();
    expect(releaseNotesContent('Empty', [], 'a › b › c')).toBe(`<!-- Generated by the Product Backlog view from "a › b › c". Rewritten in full whenever it is regenerated. -->\n\n# Empty\n\nThis file is generated. Edits to it do not survive the next regeneration.\n\nIt lists this release’s members, as its scope tree draws them.\n\nThis release contained nothing.\n`);
    expect(releaseNotesContent('X', [{ item: { ...model.byPath.get('w/Epic.md')!, typeName: 'Spike', title: 'Odd' }, depth: 0, context: false }], 's')).toContain('## Other\n\n- Odd\n');
    expect(generatedSource(releaseNotesContent('X', [], 'a--b<c>'))).toBe('a--b<c>');
    expect(releaseNotesContent('X', [], 'a--b<c>')).toContain('from "a%2D-b%3Cc%3E"');
    expect(releaseNotesPath(release.notesFolder, '1.0')).toBe('docs/notes/1.0 release notes.md');
    expect(releaseNotesPath('', '1.0')).toBe('1.0 release notes.md');
  });
});
