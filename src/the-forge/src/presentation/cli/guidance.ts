import { AppError, forgeError } from '../../domain/shared/errors.ts';
import { commandMode, commandOptions, type CommandMetadata } from '../../application/plugins/command-metadata.ts';
import { globalOptions } from '../../application/plugins/command-input.ts';
import { optionSuggestions } from '../../application/plugins/suggestions.ts';

/**
 * Failures of an invocation enriched from the command's metadata, so an agent can correct the call from the error
 * alone: an unknown option names the command and the options it accepts that are spelled alike. The host counts
 * positional arguments itself (`ensureArguments`).
 */

/** The global options a command invocation accepts: routing options precede the command and --version takes none. */
const commandGlobals = Object.keys(globalOptions).filter(key => !['root', 'no-plugins', 'version'].includes(key));

/** UNKNOWN_OPTION for a Commander unknown-option diagnostic, with suggestions among the option names `accepts`. */
export function unknownOption(diagnostic: string, accepts: readonly string[]): AppError {
  const token = /'([^']+)'/.exec(diagnostic)?.[1] ?? diagnostic;
  const option = token.split('=')[0]!;
  return forgeError('UNKNOWN_OPTION', `Unknown option ${option}.`, { option, suggestions: optionSuggestions(option, accepts) });
}

/** The action id the leading arguments spell, such as `iteration add`; never the default action of no arguments. */
const spelledAction = (command: CommandMetadata, args: readonly string[]) => args.length === 0 ? undefined : commandMode(command, args).action;

/** The command, or `<command> <action>` when the arguments select an action, as messages name it. */
function invocationName(command: CommandMetadata, args: readonly string[]): string {
  const action = spelledAction(command, args);
  return action !== undefined ? `${command.id} ${action}` : command.id;
}

/**
 * An UNKNOWN_OPTION of a command invocation (its arguments after the command id), naming the command in its message
 * and `details.command` and suggesting only options this invocation accepts; other failures pass through.
 */
export function unknownOptionGuidance(error: unknown, command: CommandMetadata, args: readonly string[]): unknown {
  if (!(error instanceof AppError) || error.code !== 'UNKNOWN_OPTION' || typeof error.details?.option !== 'string') return error;
  const option = error.details.option, accepts = [...Object.keys(commandOptions(command, args)), ...commandGlobals];
  return forgeError('UNKNOWN_OPTION', `Unknown option ${option} for ${invocationName(command, args)}.`, { option, command: command.id, suggestions: optionSuggestions(option, accepts) });
}
