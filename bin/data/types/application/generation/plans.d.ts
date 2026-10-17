import { type WriteRequest } from '../../domain/documents/file.ts';
import type { Workspace } from '../workspace/workspace.ts';
/** Builds the failure that reports drifted generated outputs. */
export type DriftFailure = (message: string, details: {
    outputs: Array<{
        path: string;
        status: string;
    }>;
}) => Error;
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
            status: "unchanged" | "changed";
            revision: string;
            content: string;
        } | {
            path: string;
            status: "missing";
            content: string;
        })[];
    }>;
    /**
     * The plan when every output matches; otherwise the drift failure `drift` builds from the message and details
     * (`details.outputs`): GENERATION_DRIFT for `make`, or the code of the plugin that generates the files.
     */
    check(writes: readonly WriteRequest[], drift?: DriftFailure): Promise<{
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
            status: "unchanged" | "changed";
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
