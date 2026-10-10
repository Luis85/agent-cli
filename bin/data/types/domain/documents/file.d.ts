export declare function vaultPath(input: string): string;
/** Recursive libraries must not copy definitions into their own discovery scope. */
export declare function ensureSeparateDirectories(source: string, destination: string): void;
export declare const nativeFormats: {
    readonly markdown: readonly ["md"];
    readonly canvas: readonly ["canvas"];
    readonly base: readonly ["base"];
    readonly image: readonly ["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"];
    readonly audio: readonly ["flac", "m4a", "mp3", "ogg", "wav", "webm", "3gp"];
    readonly video: readonly ["mkv", "mov", "mp4", "ogv", "webm"];
    readonly pdf: readonly ["pdf"];
};
/** Source, data and configuration files read and edited as UTF-8 text. Extensionless names and dotfiles stay attachments. */
export declare const textExtensions: readonly ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json", "jsonc", "yaml", "yml", "toml", "ini", "css", "scss", "less", "html", "htm", "xml", "vue", "svelte", "txt", "log", "csv", "tsv", "sh", "py", "sql"];
export declare const fileKinds: string[];
export declare function fileKind(path: string): string;
export declare const isStructured: (path: string) => boolean;
/** Kinds whose UTF-8 content can be edited literally and previewed as a line diff. */
export declare const isTextLike: (path: string) => boolean;
export interface FileSnapshot {
    path: string;
    bytes: Uint8Array;
    revision: string;
}
export interface WriteRequest {
    path: string;
    bytes: Uint8Array;
    expectedRevision?: string;
}
export interface FileChange {
    path: string;
    revision: string;
    operation: 'created' | 'updated' | 'deleted';
    bytes: number;
}
/** Dry-run change with a unified diff for UTF-8 text-like files, or null for binary content. */
export interface PlannedChange extends FileChange {
    diff: string | null;
}
