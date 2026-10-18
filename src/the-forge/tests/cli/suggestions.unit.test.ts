import { describe, expect, it } from 'vitest';
import { actionSuggestions, commandSuggestions, optionSuggestions } from '../../src/application/plugins/suggestions.ts';

const commands = ['list', 'links', 'read', 'read-many', 'search', 'move', 'rename', 'delete', 'create', 'write', 'stat', 'help'];

describe('did-you-mean suggestions', () => {
  it.each([
    ['lsit', ['list']], ['raed', ['read']], ['read-man', ['read-many']], ['serach', ['search']], ['List', ['list']],
    ['ls', ['list']], ['cat', ['read']], ['grep', ['search']], ['find', ['search']], ['mv', ['move']], ['rm', ['delete']],
    ['cp', ['read', 'create']], ['version', ['--version']], ['frobnicate', []],
  ])('suggests registered commands for %s', (id, expected) => {
    expect(commandSuggestions(id, commands)).toEqual(expected);
  });

  it('suggests a synonym only when its command is registered, and at most three commands', () => {
    expect(commandSuggestions('grep', ['list', 'read'])).toEqual([]);
    expect(commandSuggestions('re', ['read', 'read-many', 'rename', 'rebase'])).toEqual(['read', 'read-many', 'rename']);
  });

  it('suggests only options the invocation accepts, as flags', () => {
    const accepts = ['parts', 'project', 'json', 'dry-run', 'if-match'];
    expect(optionSuggestions('--part', accepts)).toEqual(['--parts']);
    expect(optionSuggestions('--projet=web', accepts)).toEqual(['--project']);
    expect(optionSuggestions('--dryrun', accepts)).toEqual(['--dry-run']);
    expect(optionSuggestions('--preview', accepts)).toEqual(['--dry-run']);
    expect(optionSuggestions('--force', accepts)).toEqual(['--if-match']);
    expect(optionSuggestions('-y', accepts)).toEqual(['--if-match']);
    // The command does not take --version, so neither a close spelling nor -v reaches it.
    expect(optionSuggestions('--section', accepts)).toEqual([]);
    expect(optionSuggestions('-v', accepts)).toEqual([]);
    expect(optionSuggestions('-v', ['version', 'help'])).toEqual(['--version']);
    expect(optionSuggestions('--verison', ['version', 'help'])).toEqual(['--version']);
    expect(optionSuggestions('--force', ['parts'])).toEqual([]);
  });

  it('suggests declared actions spelled alike', () => {
    expect(actionSuggestions('chek', ['check', 'tags', 'properties'])).toEqual(['check']);
    expect(actionSuggestions('bogus', ['check', 'tags', 'properties'])).toEqual([]);
  });
});
