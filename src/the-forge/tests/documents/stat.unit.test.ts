import { describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import type { FileStat } from '../../src/domain/documents/file.ts';
import { statCommand } from '../../src/presentation/documents/stat-command.ts';
import { ensureArguments } from '../../src/application/plugins/command-arguments.ts';
import { statOutput } from '../../src/presentation/documents/stat-output.ts';
import { commandAnnotations, commandInputSchema, validateCommandMetadata } from '../../src/application/plugins/command-metadata.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';
import { invocationPolicy } from '../../src/presentation/cli/invocation-policy.ts';

const command = statCommand();
const revision = 'a'.repeat(64);
function fixture(entry: FileStat) {
  const stat = vi.fn(async () => entry);
  return { stat, context: { workspace: { files: { stat } } } as unknown as CommandContext };
}
const file: FileStat = { path: 'file.bin', kind: 'file', revision, bytes: 2048 };

describe('stat metadata contract', () => {
  it('publishes a read-only schema and optional metadata-driven project routing', () => {
    expect(() => validateCommandMetadata(command as unknown as Record<string, unknown>)).not.toThrow();
    expect(commandAnnotations(command)).toMatchObject({ mutating: false, readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(invocationPolicy(command, ['file.bin'], { project: 'alpha' })).toEqual({ scope: 'project', activatePlugins: true, requestedProject: 'alpha' });
    expect(validateJsonValue(commandInputSchema(command), { args: ['file.bin'], options: { project: 'alpha' } }, 'input').issues).toEqual([]);
    expect(validateJsonValue(commandInputSchema(command), { args: [], options: {} }, 'input').issues.length).toBeGreaterThan(0);
  });
  it('returns file identity and size without asking for content or a codec', async () => {
    const { stat, context } = fixture(file);
    expect(await command.run(['file.bin'], {}, context)).toEqual(file);
    expect(stat).toHaveBeenCalledExactlyOnceWith('file.bin');
  });
  it('returns counts rather than arrays for a large folder', async () => {
    const { context } = fixture({ path: 'notes', kind: 'folder', revision, files: Array.from({ length: 5000 }, (_, i) => `${i}.txt`), folders: ['empty', 'nested'] });
    const result = await command.run(['notes'], {}, context);
    expect(result).toEqual({ path: 'notes', kind: 'folder', revision, fileCount: 5000, folderCount: 2 });
    expect(JSON.stringify(result).length).toBeLessThan(200);
    expect(validateJsonValue(statOutput, result, 'data').issues).toEqual([]);
  });
  it.each([{ args: [], code: 'MISSING_ARGUMENT' }, { args: ['a', 'b'], code: 'INVALID_ARGUMENT' }])('declares exactly one path, which the host requires ($args.length given)', ({ args, code }) => {
    expect(() => ensureArguments(command, args)).toThrow(expect.objectContaining({ code }));
  });
  it('strictly separates file and folder outputs and rejects content or child listings', () => {
    expect(validateJsonValue(statOutput, file, 'data').issues).toEqual([]);
    for (const result of [{ ...file, content: 'secret' }, { ...file, bytes: -1 }, { ...file, revision: 'invalid' },
      { path: 'notes', kind: 'folder', revision, fileCount: 1, folderCount: 0, files: ['private.md'] },
      { path: 'notes', kind: 'folder', revision, fileCount: 1 }]) {
      expect(validateJsonValue(statOutput, result, 'data').issues.length).toBeGreaterThan(0);
    }
  });
});
