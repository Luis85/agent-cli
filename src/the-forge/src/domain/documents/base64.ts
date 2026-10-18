import { ensure } from '../shared/errors.ts';

const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * The bytes of padded standard base64 text. ASCII whitespace anywhere is ignored, so output wrapped at 76 columns
 * (GNU `base64`, MIME) decodes like a single line; anything else invalid is INVALID_ENCODING with `message`.
 */
export function base64Bytes(text: string, message: string): Uint8Array {
  const compact = text.replace(/[\t\n\f\r ]+/g, '');
  ensure(base64.test(compact), 'INVALID_ENCODING', message);
  return Uint8Array.from(atob(compact), character => character.charCodeAt(0));
}
