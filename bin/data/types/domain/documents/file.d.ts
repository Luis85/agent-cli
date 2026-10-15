/** Reserved names also cover case-insensitive filesystems and Windows trailing-dot/space aliases. */
export declare function reservedPathSegment(segment: string): 'git' | 'internal' | undefined;
export declare function vaultPath(input: string): string;
/** Obsidian's vault trash: `delete` moves files here unless `--permanent` is passed. It is hidden from the metadata cache. */
export declare const trashFolder = ".trash";
/** Whether a path lies in the vault trash; letter case is ignored, as case-insensitive filesystems name one folder. */
export declare const isInTrash: (path: string) => boolean;
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
/** Source, data and configuration extensions read and edited as UTF-8 text. */
export declare const textExtensions: readonly ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json", "jsonc", "yaml", "yml", "toml", "ini", "css", "scss", "less", "html", "htm", "xml", "vue", "svelte", "txt", "log", "csv", "tsv", "sh", "ps1", "psm1", "psd1", "py", "sql"];
/**
 * Basenames read as UTF-8 text, case-insensitively, alone or with a dot suffix that starts with another character
 * (`Dockerfile.release`, not `Dockerfile.` or `Dockerfile..release`); native extensions win.
 */
export declare const textFilenames: readonly ["Dockerfile", "Containerfile"];
export declare const fileKinds: string[];
export declare function fileKind(path: string): string;
/**
 * Whether decoded UTF-8 is usable as the content of `path`. A `text` extension is only a hint: content holding U+0000
 * is binary, as Git treats NUL bytes, which also keeps BOM-less UTF-16 (valid UTF-8 byte for byte) out of text edits.
 */
export declare const isTextContent: (path: string, text: string) => boolean;
export declare const isStructured: (path: string) => boolean;
/** Kinds whose UTF-8 content can be edited literally and previewed as a line diff. */
export declare const isTextLike: (path: string) => boolean;
export interface FileSnapshot {
    path: string;
    bytes: Uint8Array;
    revision: string;
}
/** A check-only file or folder condition; an omitted revision requires the path to be absent. */
export interface GuardRequest {
    path: string;
    expectedRevision?: string;
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
/** A guarded move of a file or folder. A folder's `expectedRevision` is its folder revision (see `FileStat`). */
export interface RenameRequest {
    from: string;
    to: string;
    expectedRevision: string;
}
/** A guarded removal of a file or, recursively, a folder. A folder's `expectedRevision` is its folder revision. */
export interface RemoveRequest {
    path: string;
    expectedRevision: string;
}
/**
 * One committed move. A folder move reports the folder first, then every moved descendant folder and file in
 * path order. Files carry their unchanged revision and size.
 */
export type FileRename = {
    from: string;
    to: string;
} & ({
    kind: 'file';
    revision: string;
    bytes: number;
} | {
    kind: 'folder';
});
/**
 * A file's revision and size, or a folder's revision and contents. A folder revision is the SHA-256 of each
 * contained file's folder-relative path and revision, in path order; any change inside the folder changes it.
 */
export type FileStat = {
    path: string;
    kind: 'file';
    revision: string;
    bytes: number;
} | {
    path: string;
    kind: 'folder';
    revision: string;
    files: string[];
    folders: string[];
};
/** Dry-run change with a unified diff for UTF-8 text-like files, or null for binary content. */
export interface PlannedChange extends FileChange {
    diff: string | null;
}
