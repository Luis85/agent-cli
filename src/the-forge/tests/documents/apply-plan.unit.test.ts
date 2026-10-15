import { describe, expect, it } from 'vitest';
import { applyPlanSchema, editRequest, parsePlan, type EditOperation } from '../../src/domain/documents/apply-plan.ts';
import { defaultIssues, schemaIssues } from '../../src/domain/schema/json-schema.ts';

const inPlan = (operation: unknown) => ({ version: 1, operations: [operation] });
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

  it('summarizes the first three schema issues in the message and lists at most 20 in the details', () => {
    const operations = Array.from({ length: 25 }, () => ({ op: 'move', from: 'a.md' }));
    const error = failure({ version: 1, operations });
    expect(error.message).toBe('The plan does not match its schema: plan.operations[0].to: is required; plan.operations[1].to: is required; plan.operations[2].to: is required');
    expect(error.details).toMatchObject({ operation: 0 });
    expect(error.details!.issues).toHaveLength(20);
    expect(failure({ operations: [] }).details).not.toHaveProperty('operation');
  });

  it('names an invalid operation by its full index', () => {
    const operations = [...Array.from({ length: 12 }, () => ({ op: 'delete', path: 'a.md' })), { op: 'delete' }];
    expect(failure({ version: 1, operations })).toMatchObject({ details: { operation: 12, issues: ['plan.operations[12].path: is required'] } });
  });

  it('checks operations that are not objects or not a list against the schema', () => {
    expect(failure({ version: 1, operations: 5 })).toMatchObject({ code: 'INVALID_PLAN', details: { issues: [expect.stringMatching(/^plan\.operations: /)] } });
    expect(failure({ version: 1, operations: [5] })).toMatchObject({ code: 'INVALID_PLAN', details: { operation: 0 } });
    expect(failure({ version: 1, operations: [5] }).message).not.toContain('op must be one of');
    expect(failure({ version: 1, operations: [{ op: 'rename' }] }).message).toBe('Operation 0: op must be one of write, edit, frontmatter, move, delete.');
  });

  it('needs set, unset or both in a frontmatter operation', () => {
    const plan = parsePlan({ version: 1, operations: [{ op: 'frontmatter', path: 'a.md', set: { a: 1 } }, { op: 'frontmatter', path: 'a.md', unset: ['b'] }] });
    expect(plan.operations).toHaveLength(2);
    expect(failure({ version: 1, operations: [{ op: 'write', path: 'a.md', content: '' }, { op: 'frontmatter', path: 'a.md' }] })).toMatchObject({
      code: 'INVALID_PLAN', message: 'Operation 1: frontmatter needs set, unset or both.', details: { operation: 1 },
    });
  });

  it.each<[string, unknown]>([
    ['an unknown plan property', { version: 1, operations: [{ op: 'delete', path: 'a.md' }], dryRun: true }],
    ['a plan without version', { operations: [{ op: 'delete', path: 'a.md' }] }],
    ['an unknown literal edit property', inPlan({ op: 'edit', path: 'a.md', edits: [{ find: 'a', replace: 'b', regex: true }] })],
    ['a literal edit without replace', inPlan({ op: 'edit', path: 'a.md', edits: [{ find: 'a' }] })],
    ['an empty find text', inPlan({ op: 'edit', path: 'a.md', edits: [{ find: '', replace: 'b' }] })],
    ['a replacement that is not text', inPlan({ op: 'edit', path: 'a.md', edits: [{ find: 'a', replace: 5 }] })],
    ['literal edits without a path', inPlan({ op: 'edit', edits: [{ find: 'a', replace: 'b' }] })],
    ['an append without a path', inPlan({ op: 'edit', append: 'x' })],
    ['an empty path', inPlan({ op: 'delete', path: '' })],
    ['an empty ifMatch', inPlan({ op: 'delete', path: 'a.md', ifMatch: '' })],
    ['a write without content', inPlan({ op: 'write', path: 'a.md' })],
    ['a write whose content is not text', inPlan({ op: 'write', path: 'a.md', content: 5 })],
    ['a frontmatter operation without a path', inPlan({ op: 'frontmatter', set: { a: 1 } })],
    ['frontmatter set that is not an object', inPlan({ op: 'frontmatter', path: 'a.md', set: 5 })],
    ['frontmatter unset that is not a list', inPlan({ op: 'frontmatter', path: 'a.md', unset: 'a' })],
    ['an empty property name to unset', inPlan({ op: 'frontmatter', path: 'a.md', unset: [''] })],
  ])('rejects %s', (_name, plan) => {
    expect(failure(plan)).toMatchObject({ code: 'INVALID_PLAN' });
  });

  it('accepts base64 writes', () => {
    expect(parsePlan({ version: 1, operations: [{ op: 'write', path: 'a.png', content: 'AA==', encoding: 'base64' }] }).operations[0]).toMatchObject({ encoding: 'base64' });
  });

  it('carries sectionLine into a section edit', () => {
    const plan = parsePlan({ version: 1, operations: [{ op: 'edit', path: 'a.md', section: 'A > B', sectionLine: 9, replace: 'x' }] });
    expect(editRequest(plan.operations[0] as EditOperation)).toEqual({ kind: 'section', section: 'A > B', line: 9, mode: 'replace', content: 'x' });
  });
});
