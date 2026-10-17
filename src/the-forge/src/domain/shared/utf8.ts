const stripping = new TextDecoder('utf-8', { fatal: true });
const keeping = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Decodes strict UTF-8 and throws a TypeError for malformed bytes. A leading byte order mark is removed, as the
 * default TextDecoder does, unless `bom` is `keep`: text that is edited and written back keeps its exact bytes.
 */
export function decodeUtf8(bytes: Uint8Array, bom: 'strip' | 'keep' = 'strip'): string {
  return (bom === 'keep' ? keeping : stripping).decode(bytes);
}
