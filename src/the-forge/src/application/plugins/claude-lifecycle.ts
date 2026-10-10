/**
 * The contract of the `claude.lifecycle` service, which the bundled `claude` core plugin provides and implements.
 * Type declarations only, so trusted plugins type the service through the SDK without importing the plugin.
 */
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
export type ClaudeLifecycleResult =
  | { dryRun: true; executed: false; plan: ClaudeLifecyclePlan }
  | (ClaudeLifecyclePlan & { dryRun: false; executed: true; exitCode: number; stdout: string; stderr: string; result?: unknown });
export interface ClaudeLifecycleClient { execute(request: ClaudeLifecycleRequest): Promise<ClaudeLifecycleResult> }
