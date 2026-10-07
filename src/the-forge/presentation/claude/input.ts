import { ensure } from '../../domain/shared/errors.ts';
import type { CommandContext } from '../../application/plugins/registry.ts';
import { globalOptions } from '../cli/arguments.ts';
import { readInputBytes } from '../cli/input.ts';

export function claudeOptions(flags: Record<string, string | boolean>, allowed: readonly string[]): void {
  const unexpected = Object.keys(flags).filter(key => !Object.hasOwn(globalOptions, key) && !allowed.includes(key));
  ensure(unexpected.length === 0, 'INVALID_ARGUMENT', `Options do not apply to this Claude action: ${unexpected.map(key => `--${key}`).join(', ')}.`);
}

export async function claudeInput(flags: Record<string, string | boolean>, context: CommandContext): Promise<string> {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await claudeBytes(flags, context));
}

export async function claudeBytes(flags: Record<string, string | boolean>, context: CommandContext): Promise<Uint8Array> {
  return readInputBytes(flags, context, 'Supply exactly one of --from <native-file>, --content <text>, or --stdin.');
}

export const claudeInputOptions = ['from', 'content', 'stdin'] as const;
export const claudeScopeOptions = ['scope', 'directory', 'claude-dir'] as const;
