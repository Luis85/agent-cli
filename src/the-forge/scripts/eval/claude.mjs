import { evaluateChecks } from './checks.mjs';
import { installGuard } from './guard.mjs';
import { createWorkspace } from './workspace.mjs';
import { HeadlessError, completeBeforeSignal, headless } from './process.mjs';

/**
 * @typedef {import('./tasks.mjs').Task} Task
 * @typedef {import('./checks.mjs').CheckResult} CheckResult
 * @typedef {{ model?: string, maxTurns: number, timeoutMs: number, allowedTools: string[], executable: string, distribution?: string }} ClaudeOptions
 * @typedef {{
 *   answer: string, isError: boolean, turns: number | null, durationMs: number | null, costUsd: number | null,
 *   tokens: { input: number, output: number, cacheRead: number, cacheCreation: number } | null,
 *   toolCalls: { total: number, forge: number, otherBash: number, native: Record<string, number> }, forgeErrors: string[],
 *   init: { mcpServers: string[], plugins: string[] } | null,
 * }} Transcript
 * @typedef {{ id: string, driver: 'claude', attempt: number, passed: boolean, checks: CheckResult[], transcript: Transcript, error?: string, timedOut?: boolean, interrupted?: boolean }} ClaudeResult
 */

/**
 * Native tools a headless run may use without prompting, besides the guarded Forge wrapper that every run allows
 * (see guard.mjs): read-only tools only, so the agent changes files through Forge alone.
 */
export const defaultAllowedTools = ['Read', 'Glob', 'Grep'];

/** @param {string} forge the guarded wrapper command */
const instructions = forge => `You are evaluated on this task in a workspace managed by The Forge. Run The Forge as \`${forge} <command> [options]\`: it is \`node bin/forge.js\` pinned to this workspace, and the only shell command you may run, so wherever the installed skills and AGENTS.md say \`node bin/forge.js\`, use it instead. Do not ask questions; finish the task, then reply with a short final answer.`;

/**
 * Claude Code options that load no MCP server: `--strict-mcp-config` ignores every MCP configuration except
 * `--mcp-config`, which names none, so user and project servers cannot give the agent extra tools.
 */
const isolationArgs = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];

/** Forge invocations in a shell command: the guarded wrapper or the distribution's own entry point. */
const forgeCall = /(?:^|[\s/])(?:forge\.mjs|bin\/forge\.js)(?:\s|$)/;

/** @param {unknown} value @returns {Record<string, any>} */
const record = value => value !== null && typeof value === 'object' ? /** @type {Record<string, any>} */ (value) : {};

/**
 * Summarizes a `claude -p --output-format stream-json --verbose` transcript: the final answer and metrics, tool
 * calls split into Forge CLI calls, other shell commands and native tools, and Forge error codes the agent saw.
 * @param {string} stream @returns {Transcript}
 */
export function summarizeStream(stream) {
  /** @type {Transcript} */
  const summary = { answer: '', isError: true, turns: null, durationMs: null, costUsd: null, tokens: null, toolCalls: { total: 0, forge: 0, otherBash: 0, native: {} }, forgeErrors: [], init: null };
  /** @param {unknown} list */
  const names = list => Array.isArray(list) ? list.map(entry => String(record(entry).name ?? entry)) : [];
  for (const line of stream.split('\n')) {
    let event;
    try { event = record(JSON.parse(line)); } catch { continue; }
    if (event.type === 'system' && event.subtype === 'init') summary.init = { mcpServers: names(event.mcp_servers), plugins: names(event.plugins) };
    const content = Array.isArray(record(event.message).content) ? record(event.message).content : [];
    for (const item of /** @type {unknown[]} */ (content)) {
      const part = record(item);
      if (event.type === 'assistant' && part.type === 'tool_use') {
        summary.toolCalls.total += 1;
        const command = String(record(part.input).command ?? '');
        if (part.name === 'Bash' && forgeCall.test(command)) summary.toolCalls.forge += 1;
        else if (part.name === 'Bash') summary.toolCalls.otherBash += 1;
        else summary.toolCalls.native[String(part.name)] = (summary.toolCalls.native[String(part.name)] ?? 0) + 1;
      }
      if (event.type === 'user' && part.type === 'tool_result') {
        const text = typeof part.content === 'string' ? part.content
          : Array.isArray(part.content) ? part.content.map(block => String(record(block).text ?? '')).join('\n') : '';
        for (const match of text.matchAll(/"ok":\s*false[\s\S]*?"code":\s*"([A-Z][A-Z0-9_]*)"/g)) summary.forgeErrors.push(/** @type {string} */ (match[1]));
      }
    }
    if (event.type === 'result') {
      const usage = record(event.usage);
      Object.assign(summary, {
        answer: typeof event.result === 'string' ? event.result : '', isError: event.is_error === true || event.subtype !== 'success',
        turns: typeof event.num_turns === 'number' ? event.num_turns : null, durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : null,
        costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null,
        tokens: event.usage === undefined ? null : {
          input: Number(usage.input_tokens ?? 0), output: Number(usage.output_tokens ?? 0),
          cacheRead: Number(usage.cache_read_input_tokens ?? 0), cacheCreation: Number(usage.cache_creation_input_tokens ?? 0),
        },
      });
    }
  }
  return summary;
}

/**
 * Why a transcript's session was not isolated, or `undefined`: its `system` `init` event must exist and report no
 * MCP server and no Claude Code plugin, so the agent had only the tools the driver allowed.
 * @param {Transcript} transcript @returns {string | undefined}
 */
export function isolationFailure(transcript) {
  if (transcript.init === null) return 'the transcript has no system init event, so the session\'s MCP servers and plugins are unknown';
  const loaded = [...transcript.init.mcpServers.map(name => `MCP server ${name}`), ...transcript.init.plugins.map(name => `plugin ${name}`)];
  return loaded.length === 0 ? undefined : `the session loaded ${loaded.join(', ')}; run the driver where no user plugin or MCP server applies`;
}

/**
 * Runs one task with Claude Code headless in a fresh fixture workspace whose `setup` installed the Forge skills
 * into `.claude/skills`, then evaluates the task's checks against the end state and the final answer. The agent
 * may run only the guarded Forge wrapper and the read-only native tools; `dontAsk` denies everything else.
 * A SIGINT or SIGTERM to the driver ends the agent, fails the attempt as `interrupted` without evaluating its checks,
 * and removes its temporary folders before the driver ends.
 * @param {Task} task @param {ClaudeOptions} options @param {number} attempt @returns {Promise<ClaudeResult>}
 */
export function runClaude(task, options, attempt) {
  return completeBeforeSignal(attemptClaude(task, options, attempt));
}

/** @param {Task} task @param {ClaudeOptions} options @param {number} attempt @returns {Promise<ClaudeResult>} */
async function attemptClaude(task, options, attempt) {
  const workspace = await createWorkspace(task, { distribution: options.distribution });
  const guard = await installGuard(workspace.root).catch(async error => { await workspace.dispose(); throw error; });
  try {
    const prompt = `${instructions(guard.command)}\n\n${await workspace.expand(task.prompt)}`;
    const args = [
      '-p', prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--setting-sources', 'project',
      ...isolationArgs, '--permission-mode', 'dontAsk', '--max-turns', String(options.maxTurns), '--allowedTools', guard.allowedTool, ...options.allowedTools,
      ...(options.model ? ['--model', options.model] : []),
    ];
    let transcript, error, timedOut = false, interrupted = false;
    try {
      transcript = summarizeStream(await headless(options.executable, args, workspace.root, options.timeoutMs));
      error = isolationFailure(transcript);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      timedOut = failure instanceof HeadlessError && failure.timedOut;
      interrupted = failure instanceof HeadlessError && failure.interrupted;
      transcript = summarizeStream('');
    }
    const checks = interrupted ? [] : await evaluateChecks(workspace, task.checks, transcript.answer);
    return {
      id: task.id, driver: 'claude', attempt, passed: error === undefined && checks.every(check => check.passed), checks, transcript,
      ...(error ? { error } : {}), ...(timedOut ? { timedOut } : {}), ...(interrupted ? { interrupted } : {}),
    };
  } finally {
    await guard.dispose();
    await workspace.dispose();
  }
}
