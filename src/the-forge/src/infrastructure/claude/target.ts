import { homedir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { ScopedFiles } from '../../application/workspace/scoped-files.ts';
import type { CommandContext } from '../../application/plugins/registry.ts';
import type { ClaudeTarget } from '../../application/claude/target.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import { NodeFiles } from '../workspace/files.ts';

/** Resolve an explicit native configuration target without creating directories. */
export async function claudeTarget(context: CommandContext, flags: Record<string, string | boolean>): Promise<ClaudeTarget> {
  const scope = flags.scope ?? 'project';
  ensure(['project', 'local', 'user', 'plugin'].includes(String(scope)), 'INVALID_ARGUMENT', 'Native Claude scope must be project, local, user, or plugin.');
  ensure(flags['claude-dir'] === undefined || scope === 'user', 'INVALID_ARGUMENT', '--claude-dir is only valid with --scope user.');
  ensure(flags.directory === undefined || scope === 'plugin', 'INVALID_ARGUMENT', '--directory is only valid with --scope plugin.');
  if (scope === 'user') {
    const configured = flags['claude-dir'] ?? process.env.CLAUDE_CONFIG_DIR ?? resolve(homedir(), '.claude');
    ensure(typeof configured === 'string' && configured.trim().length > 0 && !configured.includes('\0'), 'INVALID_PATH', 'Claude user directory must be a nonempty path without null bytes.');
    const directory = resolve(flags['claude-dir'] === undefined ? process.cwd() : context.root, configured);
    let root = directory;
    // NodeFiles requires an existing root. Missing descendants become write plans,
    // so a preview never creates ~/.claude or any parent directory.
    while (true) {
      try { ensure((await stat(root)).isDirectory(), 'INVALID_PATH', `Not a directory: ${root}`); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = dirname(root); ensure(parent !== root, 'INVALID_PATH', 'Cannot resolve Claude user directory.'); root = parent;
      }
    }
    const files = await NodeFiles.at(root, message => context.events.warn(message));
    const prefix = relative(root, directory).split('\\').join('/');
    const scoped = prefix ? new ScopedFiles(files, vaultPath(prefix)) : files;
    return { workspace: context.workspace.within(scoped, directory), scope, directory,
      agentsDirectory: 'agents', settingsPath: 'settings.json' };
  }
  if (scope === 'plugin') {
    ensure(typeof flags.directory === 'string' && flags.directory.length > 0, 'INVALID_ARGUMENT', '--scope plugin requires --directory <plugin-root>.');
    const directory = vaultPath(flags.directory);
    return { workspace: context.workspace, scope, directory: resolve(context.root, directory), agentsDirectory: `${directory}/agents`, settingsPath: `${directory}/hooks/hooks.json` };
  }
  return { workspace: context.workspace, scope: scope as 'project' | 'local', directory: resolve(context.root, '.claude'),
    agentsDirectory: '.claude/agents', settingsPath: scope === 'local' ? '.claude/settings.local.json' : '.claude/settings.json' };
}
