import { describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { readManyCommand } from '../../src/presentation/documents/read-many-command.ts';
import { invocationPolicy } from '../../src/presentation/cli/invocation-policy.ts';
import { commandInputSchema, commandOutputSchema, validateCommandMetadata } from '../../src/application/plugins/command-metadata.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';

const command = readManyCommand();
function context(bytes = 1) {
  const read = vi.fn(async (path: string) => ({ path, revision: 'a'.repeat(64), bytes, document: { kind: 'text', content: 'x' } }));
  return { read, value: { workspace: { read } } as unknown as CommandContext };
}

describe('read-many contract', () => {
  it('declares variadic project-scoped read-only input and a bounded result schema', async () => {
    expect(() => validateCommandMetadata(command as unknown as Record<string, unknown>)).not.toThrow();
    expect(invocationPolicy(command, ['a.ts'], { project: 'other' })).toEqual({ scope: 'project', activatePlugins: true, requestedProject: 'other' });
    expect(command).toMatchObject({ mutating: false, projectOption: 'project', args: [{ variadic: true }] });
    expect(validateJsonValue(commandInputSchema(command), { args: ['a.ts', 'b.ts'], options: { project: 'other' } }, 'input').issues).toEqual([]);
    const fixture = context();
    const data = await command.run(['a.ts', 'b.ts'], {}, fixture.value);
    expect(validateJsonValue(commandOutputSchema(command, [])!, data, 'data').issues).toEqual([]);
  });
  it.each([{ paths: [] }, { paths: Array.from({ length: 33 }, (_, index) => `${index}.txt`) }])('rejects invalid file count before reading: $paths.length', async ({ paths }) => {
    const fixture = context();
    await expect(command.run(paths, {}, fixture.value)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(fixture.read).not.toHaveBeenCalled();
  });
  it('accepts exactly 32 paths in supplied order and preserves case-sensitive names', async () => {
    const fixture = context();
    const paths = ['A.md', 'a.md', ...Array.from({ length: 30 }, (_, index) => `${index}.txt`)];
    expect(await command.run(paths, {}, fixture.value)).toMatchObject({ files: paths.map(path => ({ path })), bytes: 32 });
  });
  it.each(['../a.txt', './a.txt', '/a.txt', 'dir//a.txt', 'dir\\a.txt', '.git/config'])('rejects unsafe/noncanonical path %s before any read', async path => {
    const fixture = context();
    await expect(command.run(['valid.txt', path], {}, fixture.value)).rejects.toMatchObject({ code: 'INVALID_PATH', details: { index: 1, path } });
    expect(fixture.read).not.toHaveBeenCalled();
  });
  it('rejects duplicate canonical paths before reading with both argument positions', async () => {
    const fixture = context();
    await expect(command.run(['a.txt', 'a.txt'], {}, fixture.value)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', details: { index: 1, path: 'a.txt', duplicateOf: 0 } });
    expect(fixture.read).not.toHaveBeenCalled();
  });
  it('locates unexpected failures without returning any accumulated file results', async () => {
    const fixture = context();
    fixture.read.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(command.run(['a.txt', 'b.txt'], {}, fixture.value)).rejects.toMatchObject({ code: 'OPERATION_FAILED', details: { index: 0, path: 'a.txt' } });
    expect(fixture.read).toHaveBeenCalledTimes(1);
  });
});
