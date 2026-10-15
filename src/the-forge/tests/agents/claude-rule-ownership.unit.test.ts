import { describe, expect, it } from 'vitest';
import { origins, reconcileRules, recordedRules, type RuleOrigin } from '../../src/plugins/agents/domain/claude-rule-ownership.ts';

const file = (path: string, agent?: string): RuleOrigin => (agent === undefined ? { file: path } : { file: path, agent });

describe('rule origins', () => {
  it.each<[string, RuleOrigin[][], RuleOrigin[]]>([
    ['sorts by file', [[file('agents/team.yaml'), file('agents/other.yaml')]], [file('agents/other.yaml'), file('agents/team.yaml')]],
    ['keeps origins that differ only by agent', [[file('f', 'b'), file('f', 'a')]], [file('f', 'a'), file('f', 'b')]],
    ['puts a file before its agents', [[file('f', 'Alpha'), file('f')]], [file('f'), file('f', 'Alpha')]],
    ['merges duplicates across lists', [[file('f'), file('g', 'x')], [file('g', 'x'), file('f')]], [file('f'), file('g', 'x')]],
    ['returns nothing for no lists', [], []],
  ])('%s', (_name, lists, expected) => {
    expect(origins(...lists)).toStrictEqual(expected);
  });
});

describe('recorded rules of the manifest', () => {
  it('reads each list with its deduplicated, sorted origins and leaves out empty lists', () => {
    const value = { allow: [{ rule: 'Read', origins: [{ file: 'b' }, { file: 'a', agent: 'x' }, { file: 'b' }] }], ask: [], deny: [{ rule: 'Bash', origins: [{ file: 'a' }] }] };
    expect(recordedRules('m', value)).toStrictEqual({ allow: [{ rule: 'Read', origins: [{ file: 'a', agent: 'x' }, { file: 'b' }] }], deny: [{ rule: 'Bash', origins: [{ file: 'a' }] }] });
    expect(recordedRules('m', undefined)).toStrictEqual({});
  });

  it.each<[string, unknown, string]>([
    ['permissions that are not an object', 'x', 'm permissions must be an object.'],
    ['permissions that are a list', [], 'm permissions must be an object.'],
    ['a list that is not an array', { allow: 'Read' }, 'm permissions.allow must be an array of {rule, origins}.'],
    ['a plain rule string', { deny: ['Read'] }, 'm permissions.deny must be an array of {rule, origins}.'],
    ['a rule that is not a string', { ask: [{ rule: 5, origins: [{ file: 'f' }] }] }, 'm permissions.ask must be an array of {rule, origins}.'],
    ['origins that are not a list', { allow: [{ rule: 'Read', origins: { file: 'f' } }] }, 'm permissions.allow must be an array of {rule, origins}.'],
    ['a rule without origins', { allow: [{ rule: 'Read', origins: [] }] }, 'm permissions.allow must be an array of {rule, origins}.'],
    ['an origin without a file', { ask: [{ rule: 'Read', origins: [{ agent: 'x' }] }] }, 'm permissions.ask origins must be {file, agent?} objects.'],
    ['an origin that is text', { ask: [{ rule: 'Read', origins: ['f'] }] }, 'm permissions.ask origins must be {file, agent?} objects.'],
    ['an origin with a non-string agent', { deny: [{ rule: 'Read', origins: [{ file: 'f', agent: 5 }] }] }, 'm permissions.deny origins must be {file, agent?} objects.'],
  ])('rejects %s, naming the path and list', (_name, value, message) => {
    expect(() => recordedRules('m', value)).toThrowError(expect.objectContaining({ code: 'INVALID_CLAUDE_SETTINGS', message }));
  });
});

describe('reconciling one permission list', () => {
  const recorded = (rule: string, ...from: RuleOrigin[]) => ({ rule, origins: from });

  it('keeps the user rules that no definition grants when nothing is revoked', () => {
    expect(reconcileRules('allow', ['Bash(git *)', 'Read'], [], [], { files: null })).toStrictEqual({ rules: ['Bash(git *)', 'Read'], owned: [], revoked: [] });
  });

  it('revokes a rule whose definition no longer exists, even in a run over other files', () => {
    const before = ['Read', 'Glob'];
    const previous = [recorded('Read', file('agents/old.yaml')), recorded('Glob', file('agents/kept.yaml'))];
    const coverage = { files: ['agents/team.yaml'], existing: ['agents/team.yaml', 'agents/kept.yaml'] };
    expect(reconcileRules('ask', before, previous, [], coverage)).toStrictEqual({
      rules: ['Glob'], owned: [recorded('Glob', file('agents/kept.yaml'))], revoked: [{ list: 'ask', rule: 'Read', origins: [file('agents/old.yaml')] }],
    });
    // While the file still exists, a run over other files keeps its rule.
    expect(reconcileRules('ask', before, previous, [], { files: ['agents/team.yaml'], existing: ['agents/old.yaml', 'agents/kept.yaml'] }).revoked).toStrictEqual([]);
  });

  it('owns granted rules it adds and merges their origins with the ones it keeps', () => {
    const previous = [recorded('Read', file('a'), file('b'))];
    const granted = [recorded('Read', file('a')), recorded('Grep', file('a'))];
    expect(reconcileRules('allow', ['Read', 'Edit'], previous, granted, { files: ['a'] })).toStrictEqual({
      rules: ['Read', 'Edit', 'Grep'], owned: [recorded('Read', file('a'), file('b')), recorded('Grep', file('a'))], revoked: [],
    });
  });
});
