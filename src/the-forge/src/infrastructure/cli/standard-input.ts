import { ensure } from '../../domain/shared/errors.ts';

/** The piped standard input of `--stdin`, read once to its end; a terminal fails with INPUT_REQUIRED. */
export async function standardInput(): Promise<Uint8Array> {
  ensure(!process.stdin.isTTY, 'INPUT_REQUIRED', '--stdin needs piped input.');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}
