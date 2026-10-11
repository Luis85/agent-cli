import { describe, expect, it } from 'vitest';
import { fill } from '../../src/domain/shared/messages.ts';
import { indexMessages } from '../../src/plugins/bases/application/messages.ts';
import { localizedQuery } from '../../src/plugins/bases/presentation/messages.ts';

describe('Bases index warnings', () => {
  const result = {
    path: 'Tasks.base', warnings: [
      { code: 'ambiguous-link' as const, path: 'a.md', link: 'Plan', candidates: ['x/Plan.md', 'y/Plan.md'], resolvedPath: 'x/Plan.md', message: fill(indexMessages.ambiguousLink, { link: 'Plan', source: 'a.md', candidates: 'x/Plan.md, y/Plan.md', resolved: 'x/Plan.md' }) },
      { code: 'unparseable-note' as const, path: 'b.md', message: fill(indexMessages.unparseableNote, { path: 'b.md', problem: 'Map keys must be unique' }) },
    ],
  };

  it('read in German with paths and the parser diagnostic as written', () => {
    expect(localizedQuery(result, 'de').warnings.map(warning => warning.message)).toEqual([
      'Der Link Plan in a.md passt auf x/Plan.md, y/Plan.md; er wird zur nächstgelegenen Datei x/Plan.md aufgelöst.',
      'b.md kann nicht geparst werden und wird ohne Eigenschaften, Links und Tags indexiert: Map keys must be unique',
    ]);
    expect(localizedQuery(result, 'de').warnings[0]).toMatchObject({ code: 'ambiguous-link', resolvedPath: 'x/Plan.md' });
    expect(localizedQuery(result, 'en')).toBe(result);
  });
});
