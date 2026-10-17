import type { Workspace } from '../workspace/workspace.ts';
import type { Backlink, MetadataIndex } from '../metadata/ports.ts';
import { type UnrewrittenLink } from './link-plan.ts';
/** `ifMatch` guards the source: a file revision or a folder revision from `stat`. Without it the current revision is used. */
export interface MoveOptions {
    ifMatch?: string;
    updateLinks?: boolean;
}
export interface DeleteOptions {
    ifMatch?: string;
    permanent?: boolean;
    allowBrokenLinks?: boolean;
    recursive?: boolean;
}
/** A link into a deleted file or folder; `line` is 1-based for body links and null for frontmatter and Canvas links. */
export interface BrokenLink {
    source: string;
    target: string;
    kind: Backlink['kind'];
    line: number | null;
    original: string;
    key?: string;
    node?: string;
}
/** A file or folder a delete removed from its path: files in batch order, then folders, child before parent. */
interface DeletedEntry {
    path: string;
    kind: 'file' | 'folder';
    revision?: string;
    bytes?: number;
}
/** Which paths are off limits: the scope root's `.obsidian` and `.forge` always, and `bin` at workspace scope. */
export interface FileManagerScope {
    workspace: boolean;
}
/**
 * Obsidian's FileManager for the agent: moves and renames that keep every link intact, guarded deletion to the
 * vault trash, and atomic frontmatter edits. Everything runs through the scope's Workspace, so dry runs, revision
 * guards, `vault.*` records and post-commit metadata events stay identical to every other write.
 */
export declare class FileManager {
    private readonly workspace;
    private readonly metadata;
    private readonly scope;
    constructor(workspace: Workspace, metadata: MetadataIndex, scope: FileManagerScope);
    /**
     * Moves a file or folder and, unless `updateLinks` is false, rewrites every link to it in the same batch. A
     * destination that ends with `/` or names an existing folder receives the source under its own name. A retry
     * whose source is gone while the destination holds the `ifMatch` revision reports `alreadyApplied` and writes nothing.
     */
    move(from: string, to: string, options?: MoveOptions): Promise<{
        dryRun: boolean;
        from: string;
        to: string;
        kind: "file" | "folder";
        revision: string;
        renames: never[];
        changes: never[];
        links: {
            updated: number;
            files: number;
            unrewritten: UnrewrittenLink[];
        };
        alreadyApplied: true;
    } | {
        dryRun: boolean;
        from: string;
        to: string;
        kind: "file" | "folder";
        revision: string;
        renames: import("../../sdk.ts").FileRename[];
        changes: import("../../sdk.ts").FileChange[];
        links: {
            updated: number;
            files: number;
            unrewritten: UnrewrittenLink[];
        };
    }>;
    /** Moves `from` to exactly `to`. */
    private relocate;
    /**
     * Renames in place: `name` has no slash; a file keeps its extension when `name` omits it. A retry after the
     * rename (the source is gone and `ifMatch` is given) treats the source as a file, like `move` reports it.
     */
    rename(path: string, name: string, options?: MoveOptions): Promise<{
        dryRun: boolean;
        from: string;
        to: string;
        kind: "file" | "folder";
        revision: string;
        renames: never[];
        changes: never[];
        links: {
            updated: number;
            files: number;
            unrewritten: UnrewrittenLink[];
        };
        alreadyApplied: true;
    } | {
        dryRun: boolean;
        from: string;
        to: string;
        kind: "file" | "folder";
        revision: string;
        renames: import("../../sdk.ts").FileRename[];
        changes: import("../../sdk.ts").FileChange[];
        links: {
            updated: number;
            files: number;
            unrewritten: UnrewrittenLink[];
        };
    }>;
    /**
     * Deletes a file, or a folder with `recursive`, moving it to `.trash/` unless `permanent` is set. Refuses with
     * HAS_BACKLINKS while files outside the deleted path link into it, unless `allowBrokenLinks` is set.
     */
    delete(path: string, options?: DeleteOptions): Promise<{
        dryRun: boolean;
        path: string;
        kind: "file" | "folder";
        revision: string;
        permanent: boolean;
        trashPath: null;
        deleted: DeletedEntry[];
        brokenLinks: BrokenLink[];
    } | {
        dryRun: boolean;
        path: string;
        kind: "file" | "folder";
        revision: string;
        permanent: boolean;
        trashPath: string;
        deleted: DeletedEntry[];
        brokenLinks: BrokenLink[];
    }>;
    /** Obsidian's `renameFile`: a move that updates links. */
    renameFile(path: string, newPath: string, options?: Omit<MoveOptions, 'updateLinks'>): Promise<{
        dryRun: boolean;
        from: string;
        to: string;
        kind: "file" | "folder";
        revision: string;
        renames: never[];
        changes: never[];
        links: {
            updated: number;
            files: number;
            unrewritten: UnrewrittenLink[];
        };
        alreadyApplied: true;
    } | {
        dryRun: boolean;
        from: string;
        to: string;
        kind: "file" | "folder";
        revision: string;
        renames: import("../../sdk.ts").FileRename[];
        changes: import("../../sdk.ts").FileChange[];
        links: {
            updated: number;
            files: number;
            unrewritten: UnrewrittenLink[];
        };
    }>;
    /** Obsidian's `trashFile`: moves a file or folder to `.trash/`, refusing while other files link into it. */
    trashFile(path: string, options?: Omit<DeleteOptions, 'permanent' | 'recursive'>): Promise<{
        dryRun: boolean;
        path: string;
        kind: "file" | "folder";
        revision: string;
        permanent: boolean;
        trashPath: null;
        deleted: DeletedEntry[];
        brokenLinks: BrokenLink[];
    } | {
        dryRun: boolean;
        path: string;
        kind: "file" | "folder";
        revision: string;
        permanent: boolean;
        trashPath: string;
        deleted: DeletedEntry[];
        brokenLinks: BrokenLink[];
    }>;
    /**
     * Obsidian's `processFrontMatter`: `fn` mutates a copy of the note's properties; changed keys are set and removed
     * keys deleted in one guarded edit that preserves the body. Without `ifMatch`, the revision read here guards it.
     */
    processFrontMatter(path: string, fn: (frontmatter: Record<string, unknown>) => void | Promise<void>, options?: {
        ifMatch?: string;
    }): Promise<{
        dryRun: boolean;
        changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
    }>;
    /** Links from outside `path` that resolve to it or into it. */
    private brokenLinks;
    /** The trash name of `path` for a given copy number, ignoring trash folders that are files on the way. */
    private trashCandidate;
    /**
     * `.trash/<path>`, or with ` 1`, ` 2`… before the extension when that name is taken, as Obsidian names trash copies.
     * A trash folder on the way that is a file (an extensionless file trashed earlier) is passed by such a name too.
     */
    private trashDestination;
    /** The first copy name of `name` in `folder` that is a folder or free; reading tells a file from a folder without walking it. */
    private trashFolderName;
    private isFolder;
    /** The move's source, or the result of a move that already happened: the source is gone and `to` has `ifMatch`. */
    private source;
    /**
     * NOT_FOUND for a delete whose path is gone. When `ifMatch` names the revision of an entry in `.trash` under the
     * name this delete would have given it, details report `alreadyDeleted` and that `trashPath`: an earlier identical
     * delete (or another one) moved it there. The code stays NOT_FOUND, so a mistyped path never reads as success.
     */
    private missing;
    private ensureAbsent;
    /** Protect every alias of the reserved roots: letter case, Windows trailing dots, spaces and short names, HFS+ ignorable code points. */
    private ensureMovable;
}
export {};
