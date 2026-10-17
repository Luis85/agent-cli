import { ensure, forgeError } from '../../domain/shared/errors.ts';
import type { CommandFlags } from './command-metadata.ts';
import type { CommandContext } from './registry.ts';

/** The parser types of the global options, which every command accepts in addition to its own. */
export const globalOptions = {
  root: 'string', lang: 'string', events: 'string', json: 'boolean', 'no-json': 'boolean',
  'dry-run': 'boolean', 'no-dry-run': 'boolean', 'no-plugins': 'boolean',
  help: 'boolean', version: 'boolean',
} as const;

/** The MISSING_ARGUMENT message of an absent required option; a missing revision guard says where revisions come from. */
export function requiredOptionMessage(key: string): string {
  return key === 'if-match'
    ? '--if-match is required: pass the current revision, data.revision from read or stat (a move, rename or delete dry run reports it too).'
    : `--${key} is required.`;
}

/** A string option's value; `required` reports MISSING_ARGUMENT when it is absent. */
export function value(flags: CommandFlags, key: string, required = false): string | undefined {
  const result = flags[key];
  if (required && typeof result !== 'string') throw forgeError('MISSING_ARGUMENT', requiredOptionMessage(key), { option: key });
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
