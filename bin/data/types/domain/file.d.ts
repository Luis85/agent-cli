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
export declare function fileKind(path: string): string;
export declare const isStructured: (path: string) => boolean;
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
    operation: 'created' | 'updated';
    bytes: number;
}
