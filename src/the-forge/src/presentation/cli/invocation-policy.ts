import { commandMode, type CommandFlags, type CommandMetadata } from '../../application/plugins/command-metadata.ts';
import { value } from '../../application/plugins/command-input.ts';

export interface InvocationPolicy {
  scope: 'workspace' | 'project';
  activatePlugins: boolean;
  requestedProject?: string;
}

/**
 * Derives scope and plugin activation from the command's declared metadata; arguments exclude the command id.
 * `--help` and discovery commands run at workspace scope without plugin activation, so recovery stays independent
 * of saved projects and plugin startup. A declared `projectOption` explicitly selects the project.
 */
export function invocationPolicy(command: CommandMetadata, args: readonly string[], flags: CommandFlags): InvocationPolicy {
  const mode = commandMode(command, args);
  const help = flags.help === true;
  const requestedProject = mode.projectOption === undefined ? undefined : value(flags, mode.projectOption);
  return {
    scope: help || mode.discovery || mode.scope === 'workspace' ? 'workspace' : 'project',
    activatePlugins: !help && !mode.discovery,
    ...(requestedProject === undefined ? {} : { requestedProject }),
  };
}

/**
 * Selecting a project through a declared `projectOption` fails with these codes: a malformed name, no such project,
 * or invalid project metadata. Without the option the selected project applies, whose failures are `commonErrors`.
 */
export const projectOptionErrors = ['INVALID_PROJECT_NAME', 'PROJECT_NOT_FOUND', 'INVALID_PROJECT'] as const;

/**
 * The codes a command publishes in `help` and `schema`: its own `errors`, then `projectOptionErrors` when the command
 * or one of its actions declares a `projectOption`, so no command lists project routing codes by hand.
 */
export function declaredErrors(command: CommandMetadata): string[] {
  const own = command.errors ?? [];
  const routed = command.projectOption !== undefined || Object.values(command.actions ?? {}).some(action => action.projectOption !== undefined);
  return routed ? [...new Set([...own, ...projectOptionErrors])] : [...own];
}
