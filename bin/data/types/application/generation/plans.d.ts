import { type WriteRequest } from '../../domain/documents/file.ts';
import type { Workspace } from '../workspace/workspace.ts';
/** Shared deterministic-generation review and explicit overwrite policy. */
export declare class GenerationService {
    private readonly workspace;
    constructor(workspace: Workspace);
    commit(writes: readonly WriteRequest[], revisions?: Record<string, string>): Promise<{
        preview?: {
            path: string;
            content: string;
        }[] | undefined;
        dryRun: boolean;
        changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
    }>;
    /** Snapshot revisions independently from the later explicit write authorization. */
    plan(writes: readonly WriteRequest[], manifestPath?: string): Promise<{
        manifest?: {
            preview?: {
                path: string;
                content: string;
            }[] | undefined;
            dryRun: boolean;
            changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
            path: string;
        } | undefined;
        matches: boolean;
        revisions: {
            [k: string]: string;
        };
        outputs: ({
            currentContent?: string | undefined;
            path: string;
            status: "changed" | "unchanged";
            revision: string;
            content: string;
        } | {
            path: string;
            status: "missing";
            content: string;
        })[];
    }>;
    check(writes: readonly WriteRequest[], errorCode: 'UI_DRIFT' | 'DATA_SOURCE_DRIFT' | 'GENERATION_DRIFT'): Promise<{
        manifest?: {
            preview?: {
                path: string;
                content: string;
            }[] | undefined;
            dryRun: boolean;
            changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
            path: string;
        } | undefined;
        matches: boolean;
        revisions: {
            [k: string]: string;
        };
        outputs: ({
            currentContent?: string | undefined;
            path: string;
            status: "changed" | "unchanged";
            revision: string;
            content: string;
        } | {
            path: string;
            status: "missing";
            content: string;
        })[];
    }>;
    private validate;
    private overlaps;
    private write;
}
