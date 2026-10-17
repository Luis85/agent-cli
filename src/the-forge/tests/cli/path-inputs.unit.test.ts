import { describe, expect, it } from 'vitest';
import { normalizeInputPath, normalizedPathInputs } from '../../src/presentation/cli/path-inputs.ts';
import { option, type CommandMetadata } from '../../src/application/plugins/command-metadata.ts';

const workspace = { root: '/work/vault', workspaceRoot: '/work/vault' };
const project = { root: '/work/vault/src/app', workspaceRoot: '/work/vault' };
const create: CommandMetadata = {
  id: 'create', description: 'Create.', usage: 'create <path>',
  args: [{ name: 'path', description: 'Path.', required: true, path: true }],
  options: { from: option.string('Source.', { path: true }), stdin: option.boolean('Stdin.'), content: option.string('Text.') },
};
const many: CommandMetadata = { id: 'many', description: 'Many.', usage: 'many <paths...>', args: [{ name: 'paths', description: 'Paths.', variadic: true, path: true }] };
const plain: CommandMetadata = { id: 'plain', description: 'Plain.', usage: 'plain <name>', args: [{ name: 'name', description: 'Name.' }], options: { from: option.string('Source.') } };
const failure = (run: () => unknown) => { try { run(); } catch (error) { return error; } throw new Error('expected a failure'); };

describe('normalizing agent path forms', () => {
  it.each([
    ['./specs/plan.md', 'specs/plan.md'], ['././specs/plan.md', 'specs/plan.md'], ['specs\\plan.md', 'specs/plan.md'], ['.\\specs\\plan.md', 'specs/plan.md'],
    ['/work/vault/specs/plan.md', 'specs/plan.md'], ['/work/vault/./specs/plan.md', 'specs/plan.md'], ['specs/plan.md', 'specs/plan.md'],
  ])('reads %s as %s at the workspace root', (input, expected) => {
    expect(normalizeInputPath(input, workspace.root)).toBe(expected);
    expect(normalizedPathInputs(create, [input], { from: input }, workspace)).toEqual([[expected], { from: expected }]);
  });

  it('accepts Windows absolute paths inside the root with either separator and drive letter case', () => {
    for (const input of ['C:\\Users\\me\\vault\\notes\\a.md', 'c:/Users/me/vault/notes/a.md', 'C:\\Users\\me\\vault\\.\\notes\\a.md']) {
      expect(normalizeInputPath(input, 'C:\\Users\\me\\vault')).toBe('notes/a.md');
    }
    // Only the drive letter ignores case; the rest of the root must match exactly.
    expect(normalizeInputPath('C:\\users\\me\\vault\\a.md', 'C:\\Users\\me\\vault')).toBe('C:/users/me/vault/a.md');
  });

  it('keeps absolute paths outside the root, sibling prefixes and traversal unchanged so validation refuses them', () => {
    for (const input of ['/work/vault2/a.md', '/work/a.md', '/work/vault/../outside.md', '/WORK/vault/a.md', '../a.md', 'a/../../b.md']) {
      const error = failure(() => normalizedPathInputs(create, [input], {}, workspace));
      expect(error, input).toMatchObject({ code: 'INVALID_PATH', details: { argument: 'path', value: input } });
    }
    expect(normalizeInputPath('/work/vault2/a.md', workspace.root)).toBe('/work/vault2/a.md');
    expect(normalizeInputPath('/work/vault/../outside.md', workspace.root)).toBe('../outside.md');
  });

  it('keeps a trailing slash for the command and leaves undeclared values and stdin markers alone', () => {
    expect(normalizedPathInputs(create, ['./archive/'], {}, workspace)[0]).toEqual(['archive/']);
    expect(normalizedPathInputs(plain, ['./x', 'y\\z'], { from: './a' }, workspace)).toEqual([['./x', 'y\\z'], { from: './a' }]);
    expect(normalizedPathInputs(create, ['-'], {}, workspace)[0]).toEqual(['-']);
  });

  it('resolves absolute paths against the selected project and explains a path in another part of the workspace', () => {
    expect(normalizedPathInputs(create, ['/work/vault/src/app/notes/a.md'], {}, project)[0]).toEqual(['notes/a.md']);
    const error = failure(() => normalizedPathInputs(create, ['/work/vault/docs/a.md'], {}, project));
    expect(error).toMatchObject({ code: 'INVALID_PATH', message: expect.stringContaining('outside the selected project'), details: { argument: 'path', value: '/work/vault/docs/a.md' } });
    expect((error as { details: object }).details).not.toHaveProperty('suggestion');
  });
});

describe('naming rejected paths', () => {
  it('names the argument or option and suggests the resolved path when it stays inside the scope', () => {
    expect(failure(() => normalizedPathInputs(create, ['notes/../a.md'], {}, workspace))).toMatchObject({
      code: 'INVALID_PATH', message: expect.stringMatching(/^Argument <path> "notes\/\.\.\/a\.md": /), details: { argument: 'path', value: 'notes/../a.md', suggestion: 'a.md' },
    });
    expect(failure(() => normalizedPathInputs(create, ['a.md'], { from: 'notes//b.md' }, workspace))).toMatchObject({
      message: expect.stringMatching(/^Option --from "notes\/\/b\.md": /), details: { option: 'from', value: 'notes//b.md', suggestion: 'notes/b.md' },
    });
    expect(failure(() => normalizedPathInputs(many, ['a.md', 'b/./c.md'], {}, workspace))).toMatchObject({
      message: expect.stringMatching(/^Argument <paths> at index 1 /), details: { argument: 'paths', index: 1, suggestion: 'b/c.md' },
    });
  });

  it('suggests --stdin for a source file outside the workspace of a command that reads standard input', () => {
    for (const from of ['/tmp/plan.md', '../outside.md', 'D:\\other\\plan.md']) {
      expect(failure(() => normalizedPathInputs(create, ['a.md'], { from }, workspace)), from).toMatchObject({
        code: 'INVALID_PATH', message: expect.stringContaining('pipe it with --stdin'), details: { option: 'from', value: from, suggestion: '--stdin' },
      });
    }
    // An argument never suggests --stdin, and neither does a reserved path that a suggestion cannot fix.
    const argument = failure(() => normalizedPathInputs(create, ['/tmp/plan.md'], {}, workspace)) as { details: object };
    expect(argument.details).not.toHaveProperty('suggestion');
    const reserved = failure(() => normalizedPathInputs(create, ['./.git/config'], {}, workspace)) as { details: object };
    expect(reserved).toMatchObject({ details: { argument: 'path', value: './.git/config' } });
    expect(reserved.details).not.toHaveProperty('suggestion');
    expect(failure(() => normalizedPathInputs(create, ['x/../.git/config'], {}, workspace))).not.toHaveProperty('details.suggestion');
  });
});
