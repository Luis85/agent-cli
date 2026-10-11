import { describe, expect, it } from 'vitest';
import { validateBaseFile } from '../../src/plugins/bases/application/validation.ts';
import { baseDefinitionIssues } from '../../src/plugins/bases/infrastructure/validation.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { MemoryFiles } from '../support/metadata.ts';

describe('static Base validation (the bases.validation service)', () => {
  it('accepts a definition that bases query would evaluate', () => {
    expect(baseDefinitionIssues({
      filters: { and: ['file.hasTag("task")', 'status != "done"'] },
      formulas: { age: 'now() - file.ctime', label: 'formula.age + 1' },
      views: [{ type: 'table', name: 'Open', sort: [{ property: 'formula.age', direction: 'DESC' }], groupBy: { property: 'status', direction: 'ASC' }, groupOrder: ['open'] }],
    })).toEqual([]);
  });

  it('reports every problem query would reject before reading files, global ones first, then per view', () => {
    expect(baseDefinitionIssues({
      formulas: { broken: 'status ===', loop: 'formula.again', again: 'formula.loop' },
      filters: 'file.name ==',
      views: [
        { type: 'table', name: 'A', filters: { or: ['x ==='] } },
        { type: 'table', name: 'A', sort: [{ property: 'status', direction: 'UP' }], groupOrder: ['x'] },
      ],
    })).toEqual([
      { code: 'INVALID_BASE_QUERY', message: 'Base view names must be unique.' },
      { code: 'INVALID_BASE_EXPRESSION', message: expect.stringMatching(/^Formula broken: /) },
      { code: 'INVALID_BASE_EXPRESSION', message: expect.any(String) },
      { code: 'INVALID_BASE_EXPRESSION', message: expect.any(String), view: 'A' },
      { code: 'INVALID_BASE_QUERY', message: 'Sort and groupBy direction must be ASC or DESC.', view: 'A' },
      { code: 'INVALID_BASE_QUERY', message: 'groupOrder requires groupBy and a list of visible group values.', view: 'A' },
    ]);
    expect(baseDefinitionIssues({ formulas: { loop: 'formula.again', again: 'formula.loop' } })).toEqual([
      { code: 'INVALID_BASE_EXPRESSION', message: expect.stringMatching(/^Formulas: /) },
    ]);
  });

  it('reports structural codec failures of the file as one issue', async () => {
    const files = new MemoryFiles({ 'bad.base': 'views: 3\n', 'yaml.base': 'views: [\n', 'ok.base': 'views:\n  - type: table\n    name: All\n' });
    const validate = (path: string) => validateBaseFile(files, new ObsidianDocuments(), baseDefinitionIssues, path);
    expect(await validate('bad.base')).toEqual([{ code: 'INVALID_BASE', message: 'Views need type and name strings.' }]);
    expect(await validate('yaml.base')).toEqual([{ code: 'INVALID_YAML', message: expect.any(String) }]);
    expect(await validate('ok.base')).toEqual([]);
    await expect(validate('missing.base')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
