import type { Command } from '../../application/plugins/registry.ts';
import { arity } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { statOutput } from './stat-output.ts';

/** Inspect repository revisions without parsing documents or returning their contents. */
export function statCommand(): Command {
  return {
    id: 'stat', description: 'Inspect a file or folder revision with size or descendant counts, without returning content.',
    examples: ['stat notes/idea.md', 'stat notes'],
    usage: 'stat <path> [--project id]', scope: 'project', projectOption: 'project', discovery: false, mutating: false,
    args: [{ name: 'path', description: 'Vault path relative to the command scope.', required: true, path: true }],
    options: { project: option.string('Use this project instead of the selected project.') },
    errors: ['NOT_FOUND', 'CONFLICT'], output: statOutput,
    async run(args, _flags, { workspace }) {
      arity(args, 1);
      const entry = await workspace.files.stat(args[0]!);
      const identity = { path: entry.path, kind: entry.kind, revision: entry.revision };
      return entry.kind === 'file'
        ? { ...identity, bytes: entry.bytes }
        : { ...identity, fileCount: entry.files.length, folderCount: entry.folders.length };
    },
  };
}
