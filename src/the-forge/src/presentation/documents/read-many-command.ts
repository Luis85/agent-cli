import type { Command, CommandContext } from '../../application/plugins/registry.ts';
import { arity } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import { AppError, ensure, errorMessage, forgeError, isRecord, locatedError } from '../../domain/shared/errors.ts';
import { readManyOutput } from './read-many-output.ts';

const maxFiles = 32, maxBytes = 8 * 1024 * 1024;
/** Locates a failure by the path's zero-based argument position, in both the message and `details.index`. */
function atPath(error: unknown, index: number, path: string): AppError {
  const failure = error instanceof AppError ? error : forgeError('OPERATION_FAILED', errorMessage(error));
  return locatedError(failure, `read-many path at index ${index}: `, { index, path });
}

/**
 * Preserve the default single-read representation; Markdown body is an opt-in single-read part. `beforeParse`
 * sees the raw byte count before the file is parsed.
 */
async function readFile(context: CommandContext, path: string, beforeParse: (bytes: number) => void) {
  const result = await context.workspace.read(path, { beforeParse });
  if (!isRecord(result.document) || result.document.kind !== 'markdown') return result;
  const { body: _body, ...document } = result.document;
  return { ...result, document };
}

export function readManyCommand(): Command {
  return {
    id: 'read-many', description: 'Read up to 32 files sequentially with revisions and an 8 MiB aggregate raw-byte limit.',
    examples: ['read-many notes/a.md notes/b.md'],
    usage: 'read-many <paths...> [--project id]', scope: 'project', projectOption: 'project', discovery: false, mutating: false,
    args: [{ name: 'paths', description: 'Vault path relative to the command scope.', required: true, variadic: true }],
    options: { project: option.string('Use this project instead of the selected project.') },
    output: readManyOutput,
    errors: ['NOT_FOUND', 'INVALID_FRONTMATTER', 'INVALID_YAML', 'INVALID_CANVAS', 'INVALID_BASE', 'INVALID_ENCODING'],
    async run(args, _flags, context) {
      arity(args, 1, maxFiles);
      // Validate the entire path list before reading; vaultPath accepts only canonical relative POSIX paths.
      const paths = new Set<string>();
      for (const [index, input] of args.entries()) {
        try {
          const path = vaultPath(input);
          ensure(!paths.has(path), 'INVALID_ARGUMENT', 'Each read-many path must be unique.', { duplicateOf: args.indexOf(path) });
          paths.add(path);
        } catch (error) { throw atPath(error, index, input); }
      }
      const files: Awaited<ReturnType<typeof readFile>>[] = [];
      let bytes = 0;
      // The budget counts raw bytes before each file is parsed, so the file that exceeds it is never parsed.
      const budget = (size: number) => {
        bytes += size;
        ensure(bytes <= maxBytes, 'INVALID_ARGUMENT', 'read-many exceeds the 8 MiB aggregate raw-byte limit.', { maxBytes, bytes });
      };
      for (const [index, path] of [...paths].entries()) {
        try { files.push(await readFile(context, path, budget)); }
        catch (error) { throw atPath(error, index, path); }
      }
      return { files, bytes };
    },
  };
}
