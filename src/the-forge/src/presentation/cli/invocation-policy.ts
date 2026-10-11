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
