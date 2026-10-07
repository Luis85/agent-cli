import type { ClaudeRuntime } from './runtime.ts';
import type { EventBus } from '../plugins/events.ts';
export type ClaudeOutput = 'text' | 'json' | 'json-last-line';
/** Literal native arguments. Plugins own operation policy; the host owns execution. */
export interface ClaudeLifecycleRequest {
    args: readonly string[];
    executable?: string;
    timeoutMs?: number;
    stdin?: string;
    output?: ClaudeOutput;
    sensitiveArgs?: readonly number[];
}
export interface ClaudeLifecyclePlan {
    executable: string;
    args: string[];
    cwd: string;
    timeoutMs?: number;
    inputBytes?: number;
}
export type ClaudeLifecycleResult = {
    dryRun: true;
    executed: false;
    plan: ClaudeLifecyclePlan;
} | (ClaudeLifecyclePlan & {
    dryRun: false;
    executed: true;
    exitCode: number;
    stdout: string;
    stderr: string;
    result?: unknown;
});
export interface ClaudeLifecycleClient {
    execute(request: ClaudeLifecycleRequest): Promise<ClaudeLifecycleResult>;
}
/** Shared by built-in commands and trusted plugin commands, with invocation scope fixed by the host. */
export declare class ClaudeLifecycle implements ClaudeLifecycleClient {
    private readonly runtime;
    private readonly scope;
    private readonly events;
    constructor(runtime: (executable: string) => ClaudeRuntime, scope: {
        cwd: string;
        dryRun: boolean;
    }, events: EventBus);
    execute(request: ClaudeLifecycleRequest): Promise<ClaudeLifecycleResult>;
    private invoke;
}
