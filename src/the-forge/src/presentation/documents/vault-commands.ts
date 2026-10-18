import type { Command } from '../../application/plugins/registry.ts';
import { value } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { deleteOutput, moveOutput } from './output.ts';

const ifMatch = option.string('SHA-256 revision of the source file (from read); required unless --dry-run.');
const project = option.string('Use this project instead of the selected project.');
const linkOptions = { 'if-match': ifMatch, 'no-update-links': option.boolean('Move without rewriting links to the moved files.'), project };
// Idempotent although --if-match is optional for a dry run: a real change requires it, and a repeat then reports
// the move as already applied, or fails with NOT_FOUND (the source was deleted) or CONFLICT.
const vaultWrite = { scope: 'project', projectOption: 'project', discovery: false, mutating: true, idempotent: true } as const;
const moveErrors = ['NOT_FOUND', 'CONFLICT', 'DESTINATION_EXISTS', 'PROTECTED_PATH', 'INVALID_MOVE'];
/** A real change needs the source's revision; a dry run may omit it and reports the revision to pass. */
const guard = (flags: Record<string, string | boolean>, dryRun: boolean) => value(flags, 'if-match', !dryRun);

/** Obsidian's file operations: guarded moves and renames that keep links intact, and deletion to the vault trash. */
export function vaultCommands(): Command[] {
  return [
    { id: 'delete', description: 'Move a file or folder to .trash, or remove it with --permanent; refuses while other files link to it.', usage: 'delete <path> --if-match sha256 [--recursive] [--permanent] [--allow-broken-links] [--project id]', ...vaultWrite, output: deleteOutput, args: [{ name: 'path', description: 'File or folder to delete.', required: true, path: true }], errors: ['NOT_FOUND', 'CONFLICT', 'PROTECTED_PATH', 'HAS_BACKLINKS'],
      examples: ['delete notes/idea.md --if-match <revision>', 'delete drafts --recursive --dry-run'],
      options: { 'if-match': ifMatch, recursive: option.boolean('Required to delete a folder.'), permanent: option.boolean('Remove instead of moving to .trash.'), 'allow-broken-links': option.boolean('Delete even while other files link to it.'), project }, async run(args, flags, { app, workspace }) {
      return app.fileManager.delete(args[0]!, {
        ifMatch: guard(flags, workspace.dryRun), recursive: flags.recursive === true, permanent: flags.permanent === true, allowBrokenLinks: flags['allow-broken-links'] === true,
      });
    } },
    { id: 'move', description: 'Move or rename a file or folder and rewrite every link to it in one guarded batch.', usage: 'move <from> <to> --if-match sha256 [--no-update-links] [--project id]', options: linkOptions, ...vaultWrite, output: moveOutput, errors: moveErrors,
      examples: ['move notes/idea.md archive/idea.md --if-match <revision>', 'move notes/idea.md archive/idea.md --dry-run'],
      args: [{ name: 'from', description: 'File or folder to move.', required: true, path: true }, { name: 'to', description: 'New path that must not exist, or a folder to move into: one ending with / or one that exists.', required: true, path: true }], async run(args, flags, { app, workspace }) {
      return app.fileManager.move(args[0]!, args[1]!, { ifMatch: guard(flags, workspace.dryRun), updateLinks: flags['no-update-links'] !== true });
    } },
    { id: 'rename', description: 'Rename a file or folder in place and rewrite every link to it; a file keeps its extension.', usage: 'rename <path> <new-name> --if-match sha256 [--no-update-links] [--project id]', options: linkOptions, ...vaultWrite, output: moveOutput, errors: moveErrors,
      examples: ['rename notes/idea.md plan.md --if-match <revision>'],
      args: [{ name: 'path', description: 'File or folder to rename.', required: true, path: true }, { name: 'new-name', description: 'New name without slashes; a file keeps its extension.', required: true }], async run(args, flags, { app, workspace }) {
      return app.fileManager.rename(args[0]!, args[1]!, { ifMatch: guard(flags, workspace.dryRun), updateLinks: flags['no-update-links'] !== true });
    } },
  ];
}
