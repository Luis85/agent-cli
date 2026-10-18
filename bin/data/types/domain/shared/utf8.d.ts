/**
 * Decodes strict UTF-8 and throws a TypeError for malformed bytes. A leading byte order mark is removed, as the
 * default TextDecoder does, unless `bom` is `keep`: text that is edited and written back keeps its exact bytes.
 */
export declare function decodeUtf8(bytes: Uint8Array, bom?: 'strip' | 'keep'): string;
