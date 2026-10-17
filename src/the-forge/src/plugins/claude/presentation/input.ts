import type { CommandContext } from '../../../application/plugins/registry.ts';
import { readInputBytes } from '../../../application/plugins/command-input.ts';
import { decodeUtf8 } from '../../../domain/shared/utf8.ts';

export async function claudeInput(flags: Record<string, string | boolean>, context: CommandContext): Promise<string> {
  return decodeUtf8(await claudeBytes(flags, context), 'keep');
}

export async function claudeBytes(flags: Record<string, string | boolean>, context: CommandContext): Promise<Uint8Array> {
  return readInputBytes(flags, context, 'Supply exactly one of --from <native-file>, --content <text>, or --stdin.');
}

export const claudeInputOptions = ['from', 'content', 'stdin'] as const;
