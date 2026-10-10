import { ensure, forgeError } from '../../domain/shared/errors.ts';
import type { CommandFlags } from './command-metadata.ts';
import type { CommandContext } from './registry.ts';

/** A string option's value; `required` reports MISSING_ARGUMENT when it is absent. */
export function value(flags: CommandFlags, key: string, required = false): string | undefined {
  const result = flags[key];
  ensure(!required || typeof result === 'string', 'MISSING_ARGUMENT', `--${key} is required.`);
  return typeof result === 'string' ? result : undefined;
}

/** An integer option of at least `minimum`, or undefined when absent; other values are INVALID_ARGUMENT. */
export function integer(flags: CommandFlags, key: string, minimum = 0): number | undefined {
  const text = value(flags, key);
  if (text === undefined) return undefined;
  ensure(/^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) >= minimum, 'INVALID_ARGUMENT', `--${key} must be an integer of at least ${minimum}.`);
  return Number(text);
}

/** Positional argument count check shared by every command. */
export function arity(args: readonly string[], min: number, max = min): void {
  ensure(args.length >= min && args.length <= max, 'INVALID_ARGUMENT', `Expected ${min === max ? min : `${min}–${max}`} positional arguments.`);
}

/** Selects raw input from exactly one of --from (read in the command's scope), --content or --stdin; callers own decoding. */
export async function readInputBytes(flags: CommandFlags, context: Pick<CommandContext, 'workspace' | 'input'>, message: string): Promise<Uint8Array> {
  const from = value(flags, 'from'), content = value(flags, 'content');
  ensure([from !== undefined, content !== undefined, flags.stdin === true].filter(Boolean).length === 1, 'INVALID_INPUT', message);
  return from !== undefined ? (await context.workspace.files.read(from)).bytes : flags.stdin ? await context.input() : new TextEncoder().encode(content!);
}

/** Parses JSON input; malformed input is INVALID_JSON. */
export function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { throw forgeError('INVALID_JSON', 'Expected valid JSON input.'); }
}
