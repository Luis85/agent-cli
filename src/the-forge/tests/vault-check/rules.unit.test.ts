import { describe, expect, it } from 'vitest';
import {
  compareFindings, effectiveSeverities, isRuleId, ruleDefaults, ruleIds, ruleSettings, severities, type Finding,
} from '../../src/plugins/vault-check/domain/rules.ts';
import { fill } from '../../src/domain/shared/messages.ts';

const finding = (fields: Partial<Finding> = {}): Finding => ({ rule: 'unresolved-link', severity: 'error', path: 'a.md', line: 2, column: 3, message: 'm', hint: '', ...fields });

describe('rules and severities', () => {
  it('names severities from most severe and lets settings turn a rule off', () => {
    expect(severities).toStrictEqual(['error', 'warning', 'info']);
    expect(ruleSettings).toStrictEqual(['error', 'warning', 'info', 'off']);
  });

  it('declares every rule with its default severity in reporting order', () => {
    expect(Object.entries(ruleDefaults)).toStrictEqual([
      ['unresolved-link', 'error'], ['unresolved-embed', 'error'], ['ambiguous-link', 'warning'], ['unresolved-anchor', 'warning'],
      ['invalid-frontmatter', 'error'], ['invalid-canvas', 'error'], ['invalid-base', 'error'], ['property-type-mismatch', 'warning'],
      ['duplicate-block-id', 'warning'], ['empty-file', 'warning'], ['orphan-attachment', 'info'],
    ]);
    expect(ruleIds).toStrictEqual(Object.keys(ruleDefaults));
  });

  it.each([
    ['unresolved-link', true], ['orphan-attachment', true], ['unresolved', false], ['', false], ['toString', false], ['constructor', false],
  ])('recognizes %j as a rule id: %s', (value, known) => {
    expect(isRuleId(value)).toBe(known);
  });

  it('overrides default severities from settings and ignores unknown names', () => {
    expect(effectiveSeverities({ 'empty-file': 'off', 'orphan-attachment': 'warning', 'no-such-rule': 'error' }))
      .toStrictEqual({ ...ruleDefaults, 'empty-file': 'off', 'orphan-attachment': 'warning' });
    expect(effectiveSeverities({})).toStrictEqual({ ...ruleDefaults });
  });
});

describe('finding order', () => {
  it.each([
    ['path', finding({ path: 'a.md', line: 9 }), finding({ path: 'b.md', line: 1 })],
    ['file-level line', finding({ line: null, column: null }), finding({ line: 1, column: 1 })],
    ['line', finding({ line: 2, column: 9 }), finding({ line: 3, column: 1 })],
    ['file-level column', finding({ column: null }), finding({ column: 1 })],
    ['column', finding({ column: 3, rule: 'orphan-attachment' }), finding({ column: 4, rule: 'unresolved-link' })],
    ['rule order', finding({ rule: 'unresolved-link', message: 'z' }), finding({ rule: 'unresolved-embed', message: 'a' })],
    ['later rule order', finding({ rule: 'empty-file' }), finding({ rule: 'orphan-attachment' })],
    ['message', finding({ message: 'a' }), finding({ message: 'b' })],
  ])('orders findings by %s', (_label, first, second) => {
    expect(compareFindings(first, second)).toBeLessThan(0);
    expect(compareFindings(second, first)).toBeGreaterThan(0);
  });

  it('treats findings that differ only in severity and hint as equal', () => {
    expect(compareFindings(finding(), finding({ severity: 'warning', hint: 'h' }))).toBe(0);
  });

  it('sorts a list by path, line, column, rule and message', () => {
    const item = (path: string, line: number | null, rule: Finding['rule'], message = 'm') => finding({ rule, path, line, column: line, message });
    const sorted = [item('b.md', 1, 'unresolved-link'), item('a.md', 2, 'unresolved-link'), item('a.md', null, 'empty-file'), item('a.md', 2, 'unresolved-link', 'a'), item('a.md', 2, 'unresolved-embed')].sort(compareFindings);
    expect(sorted.map(entry => [entry.path, entry.line, entry.rule, entry.message])).toStrictEqual([
      ['a.md', null, 'empty-file', 'm'], ['a.md', 2, 'unresolved-link', 'a'], ['a.md', 2, 'unresolved-link', 'm'], ['a.md', 2, 'unresolved-embed', 'm'], ['b.md', 1, 'unresolved-link', 'm'],
    ]);
  });
});

describe('finding messages', () => {
  it('fills message placeholders once and keeps unknown ones', () => {
    expect(fill('Link {original} in {at}; {unknown}', { original: '[[{at}]]', at: 'x' })).toBe('Link [[{at}]] in x; {unknown}');
  });
});
