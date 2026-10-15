import { describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { readManyCommand } from '../../src/presentation/documents/read-many-command.ts';
import { invocationPolicy } from '../../src/presentation/cli/invocation-policy.ts';
import { commandInputSchema, commandOutputSchema, validateCommandMetadata } from '../../src/application/plugins/command-metadata.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';

const command = readManyCommand();
/** A workspace whose reads report `bytes` raw bytes to `beforeParse`, then record the parse that follows. */
function context(bytes = 1) {
  const parsed = vi.fn();
  const read = vi.fn(async (path: string, options: { beforeParse?: (bytes: number) => void } = {}) => {
    options.beforeParse?.(bytes);
    parsed(path);
    return { path, revision: 'a'.repeat(64), bytes, document: { kind: 'text', content: 'x' } };
  });
  return { read, parsed, value: { workspace: { read } } as unknown as CommandContext };
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
  it('reads the validated paths once each, in argument order', async () => {
    const fixture = context();
    await command.run(['b.md', 'notes/a.md', 'c.txt'], {}, fixture.value);
    expect(fixture.read.mock.calls.map(([path]) => path)).toEqual(['b.md', 'notes/a.md', 'c.txt']);
  });
  it('refuses the file that exceeds the raw byte budget before parsing it', async () => {
    const fixture = context(3 * 1024 * 1024);
    await expect(command.run(['a.bin', 'b.bin', 'c.bin', 'd.bin'], {}, fixture.value)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT', details: { index: 2, path: 'c.bin', maxBytes: 8 * 1024 * 1024, bytes: 9 * 1024 * 1024 },
    });
    expect(fixture.parsed.mock.calls.map(([path]) => path)).toEqual(['a.bin', 'b.bin']);
    expect(fixture.read).toHaveBeenCalledTimes(3);
  });
  it('names the same zero-based position in the message and details.index', async () => {
    const fixture = context();
    fixture.read.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(command.run(['a.txt', 'b.txt'], {}, fixture.value)).rejects.toMatchObject({ details: { index: 0 }, message: expect.stringMatching(/^read-many path at index 0: /) });
    await expect(command.run(['a.txt', '../b.txt'], {}, fixture.value)).rejects.toMatchObject({ code: 'INVALID_PATH', details: { index: 1 }, message: expect.stringMatching(/^read-many path at index 1: /) });
  });
  it('locates unexpected failures without returning any accumulated file results', async () => {
    const fixture = context();
    fixture.read.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(command.run(['a.txt', 'b.txt'], {}, fixture.value)).rejects.toMatchObject({ code: 'OPERATION_FAILED', details: { index: 0, path: 'a.txt' } });
    expect(fixture.read).toHaveBeenCalledTimes(1);
  });
});
