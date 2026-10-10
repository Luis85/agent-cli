import type { Command } from '../../application/plugins/registry.ts';
import { arity, value } from '../cli/arguments.ts';

const linkOptions = { 'if-match': 'string', 'no-update-links': 'boolean' } as const;
/** A real change needs the source's revision; a dry run may omit it and reports the revision to pass. */
const guard = (flags: Record<string, string | boolean>, dryRun: boolean) => value(flags, 'if-match', !dryRun);

/** Obsidian's file operations: guarded moves and renames that keep links intact, and deletion to the vault trash. */
export function vaultCommands(): Command[] {
  return [
    { id: 'delete', description: 'Move a file or folder to .trash, or remove it with --permanent; refuses while other files link to it.', usage: 'delete <path> --if-match sha256 [--recursive] [--permanent] [--allow-broken-links]', options: { 'if-match': 'string', recursive: 'boolean', permanent: 'boolean', 'allow-broken-links': 'boolean' }, async run(args, flags, { app, workspace }) {
      arity(args, 1);
      return app.fileManager.delete(args[0]!, {
        ifMatch: guard(flags, workspace.dryRun), recursive: flags.recursive === true, permanent: flags.permanent === true, allowBrokenLinks: flags['allow-broken-links'] === true,
      });
    } },
    { id: 'move', description: 'Move or rename a file or folder and rewrite every link to it in one guarded batch.', usage: 'move <from> <to> --if-match sha256 [--no-update-links]', options: linkOptions, async run(args, flags, { app, workspace }) {
      arity(args, 2);
      return app.fileManager.move(args[0]!, args[1]!, { ifMatch: guard(flags, workspace.dryRun), updateLinks: flags['no-update-links'] !== true });
    } },
    { id: 'rename', description: 'Rename a file or folder in place and rewrite every link to it; a file keeps its extension.', usage: 'rename <path> <new-name> --if-match sha256 [--no-update-links]', options: linkOptions, async run(args, flags, { app, workspace }) {
      arity(args, 2);
      return app.fileManager.rename(args[0]!, args[1]!, { ifMatch: guard(flags, workspace.dryRun), updateLinks: flags['no-update-links'] !== true });
    } },
  ];
}
