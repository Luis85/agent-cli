import type { Command, CommandContext } from '../../application/plugins/registry.ts';
import { arity } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import { AppError, ensure, errorMessage, forgeError, isRecord, locatedError } from '../../domain/shared/errors.ts';
import { readManyOutput } from './read-many-output.ts';

const maxFiles = 32, maxBytes = 8 * 1024 * 1024;
function atPath(error: unknown, index: number, path: string): AppError {
  const failure = error instanceof AppError ? error : forgeError('OPERATION_FAILED', errorMessage(error));
  return locatedError(failure, `read-many path ${index + 1}: `, { index, path });
}

/** Preserve the default single-read representation; Markdown body is an opt-in single-read part. */
async function readFile(context: CommandContext, path: string) {
  const result = await context.workspace.read(path);
  if (!isRecord(result.document) || result.document.kind !== 'markdown') return result;
  const { body: _body, ...document } = result.document;
  return { ...result, document };
}

export function readManyCommand(): Command {
  return {
    id: 'read-many', description: 'Read up to 32 files sequentially with revisions and an 8 MiB aggregate raw-byte limit.',
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
      for (const [index, path] of args.entries()) {
        try {
          const file = await readFile(context, path);
          bytes += file.bytes;
          ensure(bytes <= maxBytes, 'INVALID_ARGUMENT', 'read-many exceeds the 8 MiB aggregate raw-byte limit.', { maxBytes, bytes });
          files.push(file);
        } catch (error) { throw atPath(error, index, path); }
      }
      return { files, bytes };
    },
  };
}
