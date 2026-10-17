import { kernelMessage } from '../../domain/shared/kernel-messages.ts';
import type { CommandFlags } from '../../application/plugins/command-metadata.ts';
import type { Workspace } from '../../application/workspace/workspace.ts';

/**
 * Warnings for input that is written as given but was probably meant otherwise: a text option holding the two
 * characters `\n` without any line break (a shell passed an escape literally), and `--stdin` that read no bytes.
 */
export function inputWarnings(path: string, flags: CommandFlags, bytes: Uint8Array | undefined, options: readonly string[], workspace: Pick<Workspace, 'warn'>): void {
  for (const option of options) {
    const text = flags[option];
    if (typeof text === 'string' && text.includes('\\n') && !/[\r\n]/.test(text)) workspace.warn(kernelMessage('LITERAL_NEWLINE', { option }));
  }
  if (flags.stdin === true && bytes?.length === 0) workspace.warn(kernelMessage('EMPTY_STDIN', { path }));
}
