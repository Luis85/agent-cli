import { AppError, forgeError, isRecord } from '../../domain/shared/errors.ts';
import { commandMode, commandOptions, ensureKnownAction, type CommandFlags, type CommandMetadata } from '../../application/plugins/command-metadata.ts';
import { globalOptions } from '../../application/plugins/command-input.ts';
import { optionSuggestions } from '../../application/plugins/suggestions.ts';
import type { Command, CommandContext } from '../../application/plugins/registry.ts';

/**
 * Failures of an invocation enriched from the command's metadata, so an agent can correct the call from the error
 * alone: an unknown option names the command and the options it accepts that are spelled alike, and a wrong number
 * of positional arguments names the missing arguments and the usage to follow.
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

interface ArityDetails { minimum: number; maximum: number; received: number }
const arityDetails = (details: unknown): details is ArityDetails => isRecord(details)
  && ['minimum', 'maximum', 'received'].every(key => typeof details[key] === 'number') && Object.keys(details).length === 3;

/**
 * An arity failure (`details` `{minimum, maximum, received}`) named after the command's metadata: the missing
 * positional arguments of a command without actions (also in `details.missing`), or the selected action, and the
 * usage of the command or of that action.
 * A command with actions checks the arguments after the action itself, so only its usage is reliable.
 */
function argumentGuidance(error: unknown, command: CommandMetadata, args: readonly string[]): unknown {
  if (!(error instanceof AppError) || error.code !== 'INVALID_ARGUMENT' || !arityDetails(error.details)) return error;
  const { received, minimum } = error.details;
  const id = args.length > received ? spelledAction(command, args) : undefined, action = id === undefined ? undefined : command.actions?.[id];
  const usage = action?.usage ?? command.usage;
  const missing = command.actions === undefined && received < minimum ? (command.args ?? []).slice(received, minimum).map(arg => arg.name) : [];
  const named = missing.length > 0 ? `Missing ${missing.map(name => `<${name}>`).join(' ')}. ` : action ? `${command.id} ${id!}: ` : '';
  return forgeError('INVALID_ARGUMENT', `${named}${error.message} Usage: ${usage}`, { ...error.details, ...(missing.length > 0 ? { missing } : {}) });
}

/**
 * Runs the command with its positional arguments after the id. An unknown action of a command that declares
 * `unknownAction` fails first with the declared actions, and arity failures name what the command expects.
 */
export async function runCommand(command: Command, args: string[], flags: CommandFlags, context: CommandContext): Promise<unknown> {
  ensureKnownAction(command, args);
  try { return await command.run(args, flags, context); }
  catch (error) { throw argumentGuidance(error, command, args); }
}
