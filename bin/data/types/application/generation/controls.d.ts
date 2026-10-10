import type { FileRepository } from '../workspace/ports.ts';
import { type CommandFlags, type CommandOption } from '../plugins/command-metadata.ts';
/**
 * Review controls of every reviewed generator: plan, check drift, or regenerate with approved revisions. Kernel
 * generators and core plugins (`agents generate`) share them with `GenerationService`.
 */
export declare const reviewOptions: {
    'revisions-from': CommandOption;
    plan: CommandOption;
    'plan-out': CommandOption;
    check: CommandOption;
};
export type GenerationMode = 'check' | 'plan' | 'generate';
/** The review mode of one invocation; `--revisions-from` is read from the command scope. */
export declare function generationControls(flags: CommandFlags, files: Pick<FileRepository, 'read'>): Promise<{
    mode: GenerationMode;
    manifestPath: string | undefined;
    revisions: Record<string, string> | undefined;
}>;
/**
 * Options of a generator that renders a workspace definition library into a project (`make ui`, `make stories`,
 * `make data-source`): `--project` selects the output project for one invocation and `--library` the definitions,
 * followed by the host's review controls. Such generators set `review`, which lets them list those controls.
 */
export declare const libraryGenerationOptions: {
    'revisions-from': CommandOption;
    plan: CommandOption;
    'plan-out': CommandOption;
    check: CommandOption;
    project: CommandOption;
    library: CommandOption;
};
/** Output writes use workspace paths; input manifests remain in the selected scope. */
export declare function generationOutputPath(path: string, project: {
    directory: string;
} | null): string;
