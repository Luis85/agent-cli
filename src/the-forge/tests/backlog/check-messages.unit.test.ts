import { describe, expect, it } from 'vitest';
import type { NoteSource } from '../../src/plugins/backlog/domain/items.ts';
import { buildModel } from '../../src/plugins/backlog/domain/model.ts';
import { checkBacklog } from '../../src/plugins/backlog/domain/check.ts';
import { checkMessages } from '../../src/plugins/backlog/domain/messages.ts';
import { resolveSettings } from '../../src/plugins/backlog/domain/settings-resolve.ts';
import { germanCheckMessages, localizedCheck } from '../../src/plugins/backlog/presentation/messages.ts';

function problems(notes: Record<string, Record<string, unknown>>, resolved = resolveSettings({ stateProperty: 'note.status' })) {
  const source: NoteSource = { frontmatter: path => notes[path], frontmatterLinks: () => [], resolve: () => null };
  const model = buildModel(source, Object.keys(notes), resolved, path => path in notes);
  return checkBacklog({ model, settings: resolved, releaseProblems: [], unresolvedMemberships: [], typeOf: () => null });
}

describe('backlog check messages', () => {
  it('counts unranked items in the singular and the plural', () => {
    expect(problems({ 'a.md': { type: 'Task', order: 1 }, 'b.md': { type: 'Task' } }).map(problem => problem.message)).toEqual(['1 item has no rank and sorts last; run backlog ranks seed.']);
    expect(problems({ 'a.md': { type: 'Task' }, 'b.md': { type: 'Task' } }).map(problem => problem.message)).toEqual(['2 items have no rank and sort last; run backlog ranks seed.']);
  });

  it('warns about notes hierarchyOnly hides, in the singular, the plural and German', () => {
    const one = problems({ 'a.md': { type: 'Task', order: 1 }, 'First.md': { type: 'story', order: 2 } });
    expect(one).toEqual([{ code: 'ignored', severity: 'warning', message: '1 note has no backlog type and no parent, so the backlog hides it (hierarchyOnly).', paths: ['First.md'] }]);
    const two = problems({ 'First.md': { type: 'story', order: 1 }, 'Second.md': { type: 'story', order: 2 } });
    expect(two.map(problem => [problem.code, problem.message, problem.paths])).toEqual([['ignored', '2 notes have no backlog type and no parent, so the backlog hides them (hierarchyOnly).', ['First.md', 'Second.md']]]);
    expect(localizedCheck({ problems: two }, 'de').problems[0]!.message).toBe('2 Notizen haben keinen Backlog-Typ und keinen übergeordneten Eintrag, daher blendet das Backlog sie aus (hierarchyOnly).');
    expect(problems({ 'First.md': { type: 'story', order: 1 } }, resolveSettings({ stateProperty: 'note.status', hierarchyOnly: false }))).toEqual([]);
  });

  it('reports problems in German with titles and values as written, keeping codes and fields', () => {
    const english = { ok: false, problems: [
      ...problems({ 'a.md': { type: 'Task', order: 1 }, 'b.md': { type: 'Task', order: 1 } }),
      { code: 'unparseable-note', severity: 'warning' as const, path: 'x.md', message: 'Already localized by the bases service.' },
    ] };
    const german = localizedCheck(english, 'de');
    expect(german.problems).toEqual([
      { ...english.problems[0], message: '2 Einträge teilen sich den Rang 1; Gleichstände folgen der Ergebnisreihenfolge.' },
      english.problems[1],
    ]);
    expect(localizedCheck(english, 'en')).toBe(english);
  });

  it('names a multi-word type and title as written in German', () => {
    const releases = resolveSettings({ stateProperty: 'note.status', releaseProperty: 'note.release' });
    const english = { problems: problems({ 'Login works.md': { type: 'Test case', release: ['a', 'b'], order: 1 } }, releases) };
    expect(english.problems.map(problem => problem.message)).toEqual(['The Test case item Login works may not hold release.']);
    expect(localizedCheck(english, 'de').problems.map(problem => problem.message)).toEqual(['Der Test case-Eintrag Login works darf release nicht enthalten.']);
  });

  it('has a distinct German template with the same placeholders for every English one', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const [key, template] of Object.entries(checkMessages) as Array<[keyof typeof checkMessages, string]>) {
      expect(germanCheckMessages[key], key).not.toBe(template);
      expect(placeholders(germanCheckMessages[key]), key).toEqual(placeholders(template));
    }
  });
});
