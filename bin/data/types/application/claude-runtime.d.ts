export interface ClaudeRuntimeOptions {
    cwd: string;
    timeoutMs?: number;
    stdin?: string;
}
export interface ClaudeRuntimeResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
/** Executes an already-authorized Claude CLI command; callers own command policy and dry runs. */
export interface ClaudeRuntime {
    run(args: readonly string[], options: ClaudeRuntimeOptions): Promise<ClaudeRuntimeResult>;
}
