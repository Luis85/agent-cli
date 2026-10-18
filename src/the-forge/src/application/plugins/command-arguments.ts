import { forgeError } from '../../domain/shared/errors.ts';
import { actionUsage, argumentBounds, declaredArguments, ensureKnownAction, type CommandMetadata } from './command-metadata.ts';

/** How many positional arguments a message says an invocation takes: `2`, `1–3` or `at least 1`. */
function expectedArguments(minimum: number, maximum: number | undefined): string {
  const count = maximum === minimum ? `${minimum}` : maximum === undefined ? `at least ${minimum}` : `${minimum}–${maximum}`;
  return `${count} positional argument${(maximum ?? minimum) === 1 ? '' : 's'}`;
}

/**
 * Checks the positional arguments of an invocation against its declared `args` before the command runs, so commands
 * never count them. An unknown action fails first (`ensureKnownAction`); too few arguments then fail with
 * MISSING_ARGUMENT, naming the first missing argument in `details.argument` and every missing one in
 * `details.missing`, and too many with INVALID_ARGUMENT, quoting the surplus values in `details.unexpected`. Both
 * messages end with the usage of the command or the selected action. `details` also holds the `command`, the
 * selected `action`, and `minimum`, `maximum` (absent for an unbounded variadic argument) and `received`, which count
 * the action words as the published `minItems` and `maxItems` do. An invocation without declared `args` passes.
 */
export function ensureArguments(command: CommandMetadata, args: readonly string[]): void {
  ensureKnownAction(command, args);
  const declared = declaredArguments(command, args);
  if (declared === undefined) return;
  const { minimum, maximum } = argumentBounds(declared), received = args.length;
  if (received >= minimum && (maximum === undefined || received <= maximum)) return;
  const { action } = declared;
  const usage = action === undefined ? command.usage : actionUsage(command, action);
  const where = action === undefined ? '' : `${command.id} ${action}: `;
  const counts = { command: command.id, ...(action === undefined ? {} : { action }), minimum, ...(maximum === undefined ? {} : { maximum }), received };
  const expected = `Expected ${expectedArguments(minimum, maximum)}, got ${received}. Usage: ${usage}`;
  if (received < minimum) {
    const missing = declared.args.filter(arg => arg.required).slice(received - declared.words).map(arg => arg.name);
    throw forgeError('MISSING_ARGUMENT', `${where}Missing ${missing.map(name => `<${name}>`).join(' ')}. ${expected}`, { argument: missing[0], missing, ...counts });
  }
  const unexpected = args.slice(maximum);
  throw forgeError('INVALID_ARGUMENT', `${where}Unexpected ${unexpected.map(value => JSON.stringify(value)).join(' ')}. ${expected}`, { unexpected, ...counts });
}
