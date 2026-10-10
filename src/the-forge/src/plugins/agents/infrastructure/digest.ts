import { createHash } from 'node:crypto';
import type { Digest } from '../application/ports.ts';

/** SHA-256 of UTF-8 text, as generated Claude files record it in their `x-forge-source` provenance. */
export const sha256Digest: Digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
