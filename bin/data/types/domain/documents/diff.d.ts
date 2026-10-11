export interface UnifiedDiffInput {
    path: string;
    before: string;
    after: string;
    created?: boolean;
    context?: number;
}
/** Render a Git-compatible unified diff with three context lines; identical text yields an empty string. */
export declare function unifiedDiff({ path, before, after, created, context }: UnifiedDiffInput): string;
