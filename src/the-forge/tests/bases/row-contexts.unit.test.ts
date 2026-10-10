import { describe, expect, it } from 'vitest';
import { createEvaluationContext, parseExpression, type ContextFileInput, type Expression, type PropertyValueType } from 'obsidian-bases-expression';
import { BaseRowContexts, type SharedRowInput } from '../../src/infrastructure/bases/contexts.ts';

const file = (path: string, properties: Record<string, unknown> = {}, links: [string, string | null][] = []): ContextFileInput => ({
  path, properties, size: path.length, ctime: new Date(1), mtime: new Date(2), tags: [], embeds: [], backlinks: [],
  links: links.map(([target, resolvedPath]) => ({ path: target, resolvedPath })),
});
// Shared basenames, case variants, extensionless files and prototype-like names exercise the map's overwrite order.
const files = [
  file('A/Note.md', { due: '2026-10-10', status: 'open' }, [['Note', 'B/note.md'], ['Missing', null]]),
  file('B/note.md', { due: '' }, [['__proto__', 'A/Note.md']]),
  file('C/NOTE.md', { due: null }),
  file('Note', { status: 'raw' }, [['note', 'C/NOTE.md'], ['note', 'A/Note.md']]),
  file('constructor.md'),
  file('__proto__.md', {}, [['constructor', null]]),
  file('Assets/image.png'),
  file('Deep/A/Note.md', { due: '2026-01-01' }),
];
const propertyTypes: Record<string, PropertyValueType> = { due: 'date', status: 'string' };
const formulas: Record<string, Expression> = { score: parseExpression('1 + 2').ast! };
const shared = (thisFile: ContextFileInput): SharedRowInput => ({ thisFile, formulas, propertyTypes, objects: { marker: 1 }, now: new Date(3) });

function expected(input: ContextFileInput, thisFile: ContextFileInput) {
  const rowTypes = Object.fromEntries(Object.entries(propertyTypes).filter(([name, type]) => type !== 'date' || ![undefined, null, ''].includes(input.properties?.[name] as never)));
  const linkResolutions = Object.fromEntries((input.links ?? []).map(link => [link.path, link.resolvedPath ?? null]));
  return createEvaluationContext({ note: input.properties, file: input, files, thisFile, formulas, propertyTypes: rowTypes, now: new Date(3), linkResolutions, objects: { marker: 1 } });
}

describe('prebuilt Bases row contexts', () => {
  it('equal the evaluator-built context for every row, including file order and link-map precedence', () => {
    for (const thisFile of [files[0]!, files[5]!]) {
      const rows = Array.from(new BaseRowContexts(files, shared(thisFile)).rows(), row => structuredClone({ ...row.context }));
      expect(rows).toEqual(files.map(input => structuredClone({ ...expected(input, thisFile) })));
      for (const [index, row] of rows.entries()) {
        expect(row.files!.map(item => item.path)).toEqual(expected(files[index]!, thisFile).files!.map(item => item.path));
        expect(Object.entries(row.linkResolutions!).sort()).toEqual(Object.entries(expected(files[index]!, thisFile).linkResolutions!).sort());
      }
    }
  });

  it('restores the shared link map after each row, also when iteration stops early', () => {
    const contexts = new BaseRowContexts(files, shared(files[0]!));
    for (const row of contexts.rows()) { if (row.file.path === 'Note') break; }
    const again = Array.from(contexts.rows(), row => Object.entries(row.context.linkResolutions!).sort());
    expect(again).toEqual(files.map(input => Object.entries(expected(input, files[0]!).linkResolutions!).sort()));
  });
});
