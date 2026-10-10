import { describe, expect, it } from 'vitest';
import { applyPlanSchema, editRequest, parsePlan, type EditOperation } from '../../src/domain/documents/apply-plan.ts';
import { defaultIssues, schemaIssues } from '../../src/domain/schema/json-schema.ts';

const failure = (value: unknown) => {
  try { parsePlan(value); }
  catch (error) { return error as { code: string; message: string; details?: Record<string, unknown> }; }
  throw new Error('Expected the plan to be invalid.');
};

describe('apply plan contract', () => {
  it('publishes a supported JSON Schema 2020-12 whose defaults validate', () => {
    expect(schemaIssues(applyPlanSchema)).toEqual([]);
    expect(defaultIssues(applyPlanSchema)).toEqual([]);
    expect(applyPlanSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('accepts every operation shape and fills defaults', () => {
    const plan = parsePlan({ version: 1, operations: [
      { op: 'write', path: 'a.md', content: '# A' },
      { op: 'edit', path: 'a.md', edits: [{ find: 'A', replace: 'B' }] },
      { op: 'edit', path: 'a.md', append: 'more' },
      { op: 'edit', path: 'a.md', section: 'A > B', prepend: 'x' },
      { op: 'edit', path: 'a.md', block: '^id', replace: 'y', ifMatch: 'rev' },
      { op: 'frontmatter', path: 'a.md', set: { status: 'done' }, unset: ['draft'] },
      { op: 'move', from: 'a.md', to: 'b.md' },
      { op: 'delete', path: 'b.md' },
    ] });
    expect(plan.operations[0]).toEqual({ op: 'write', path: 'a.md', content: '# A', encoding: 'utf8' });
    expect(plan.operations[1]).toEqual({ op: 'edit', path: 'a.md', edits: [{ find: 'A', replace: 'B', all: false }] });
    expect(plan.operations[6]).toEqual({ op: 'move', from: 'a.md', to: 'b.md', updateLinks: true });
    expect(plan.operations[7]).toEqual({ op: 'delete', path: 'b.md', recursive: false, allowBrokenLinks: false });
    expect(plan.operations.slice(1, 5).map(item => editRequest(item as EditOperation))).toEqual([
      { kind: 'literal', edits: [{ find: 'A', replace: 'B', all: false }] },
      { kind: 'append', content: 'more' },
      { kind: 'section', section: 'A > B', mode: 'prepend', content: 'x' },
      { kind: 'block', block: '^id', mode: 'replace', content: 'y' },
    ]);
  });

  it('names the first invalid operation by index with the schema issues', () => {
    expect(failure({ version: 2, operations: [] })).toMatchObject({ code: 'INVALID_PLAN', details: { issues: ['plan.version: must equal 1', 'plan.operations: must have at least 1 items'] } });
    expect(failure({ version: 1, operations: [{ op: 'write', path: 'a.md', content: 'x' }, { op: 'rename', path: 'a.md' }] }))
      .toMatchObject({ code: 'INVALID_PLAN', details: { operation: 1, issues: ['plan.operations[1].op: must be one of write, edit, frontmatter, move, delete'] } });
    expect(failure({ version: 1, operations: [{ op: 'move', from: 'a.md' }] })).toMatchObject({ details: { operation: 0, issues: ['plan.operations[0].to: is required'] } });
    expect(failure({ version: 1, operations: [{ op: 'edit', path: 'a.md', section: 'A', append: 'x', prepend: 'y' }] }))
      .toMatchObject({ details: { operation: 0, issues: [expect.stringMatching(/^plan\.operations\[0\]\.(append|prepend): is not allowed$/)] } });
    expect(failure({ version: 1, operations: [{ op: 'frontmatter', path: 'a.md' }] })).toMatchObject({ code: 'INVALID_PLAN', details: { operation: 0 } });
    expect(failure({ version: 1, operations: [{ op: 'edit', path: 'a.md', edits: [] }] })).toMatchObject({ details: { operation: 0 } });
    expect(failure({ version: 1, operations: [{ op: 'edit', path: 'a.md', block: 'x', sectionLine: 2, append: 'y' }] })).toMatchObject({ details: { operation: 0 } });
    expect(failure({ version: 1, operations: [{ op: 'edit', path: 'a.md', section: 'A', sectionLine: 0, append: 'y' }] })).toMatchObject({ details: { operation: 0 } });
  });

  it('carries sectionLine into a section edit', () => {
    const plan = parsePlan({ version: 1, operations: [{ op: 'edit', path: 'a.md', section: 'A > B', sectionLine: 9, replace: 'x' }] });
    expect(editRequest(plan.operations[0] as EditOperation)).toEqual({ kind: 'section', section: 'A > B', line: 9, mode: 'replace', content: 'x' });
  });
});
