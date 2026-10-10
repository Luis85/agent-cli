import { forgeError, ensure } from '../../domain/shared/errors.ts';
import type { CommandContext } from '../../application/plugins/registry.ts';
import { value, type ParsedArguments } from './arguments.ts';

export function encodeText(text: string): Uint8Array { return new TextEncoder().encode(text); }

/** Select raw input in the command's active workspace; callers own decoding. */
export async function readInputBytes(flags: ParsedArguments['flags'], context: Pick<CommandContext, 'workspace' | 'input'>, message: string): Promise<Uint8Array> {
  const from = value(flags, 'from'), content = value(flags, 'content');
  ensure([from !== undefined, content !== undefined, flags.stdin === true].filter(Boolean).length === 1, 'INVALID_INPUT', message);
  return from !== undefined ? (await context.workspace.files.read(from)).bytes : flags.stdin ? await context.input() : encodeText(content!);
}

export function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { throw forgeError('INVALID_JSON', 'Expected valid JSON input.'); }
}
