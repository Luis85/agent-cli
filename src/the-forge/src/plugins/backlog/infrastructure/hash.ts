import { createHash } from 'node:crypto';

/** The sync engine's field hash: the first 16 hex digits of the SHA-256 of the canonical value text. */
export const hashText = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
