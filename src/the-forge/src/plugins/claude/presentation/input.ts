import type { CommandContext } from '../../../application/plugins/registry.ts';
import { readInputBytes } from '../../../application/plugins/command-input.ts';

export async function claudeInput(flags: Record<string, string | boolean>, context: CommandContext): Promise<string> {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await claudeBytes(flags, context));
}

export async function claudeBytes(flags: Record<string, string | boolean>, context: CommandContext): Promise<Uint8Array> {
  return readInputBytes(flags, context, 'Supply exactly one of --from <native-file>, --content <text>, or --stdin.');
}

export const claudeInputOptions = ['from', 'content', 'stdin'] as const;
