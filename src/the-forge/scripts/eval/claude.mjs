import { spawn } from 'node:child_process';
import { evaluateChecks } from './checks.mjs';
import { installGuard } from './guard.mjs';
import { createWorkspace } from './workspace.mjs';

/**
 * @typedef {import('./tasks.mjs').Task} Task
 * @typedef {import('./checks.mjs').CheckResult} CheckResult
 * @typedef {{ model?: string, maxTurns: number, timeoutMs: number, allowedTools: string[], executable: string, distribution?: string }} ClaudeOptions
 * @typedef {{
 *   answer: string, isError: boolean, turns: number | null, durationMs: number | null, costUsd: number | null,
 *   tokens: { input: number, output: number, cacheRead: number, cacheCreation: number } | null,
 *   toolCalls: { total: number, forge: number, otherBash: number, native: Record<string, number> }, forgeErrors: string[],
 * }} Transcript
 * @typedef {{ id: string, driver: 'claude', attempt: number, passed: boolean, checks: CheckResult[], transcript: Transcript, error?: string }} ClaudeResult
 */

/**
 * Native tools a headless run may use without prompting, besides the guarded Forge wrapper that every run allows
 * (see guard.mjs): read-only tools only, so the agent changes files through Forge alone.
 */
export const defaultAllowedTools = ['Read', 'Glob', 'Grep'];

/** @param {string} forge the guarded wrapper command */
const instructions = forge => `You are evaluated on this task in a workspace managed by The Forge. Run The Forge as \`${forge} <command> [options]\`: it is \`node bin/forge.js\` pinned to this workspace, and the only shell command you may run, so wherever the installed skills and AGENTS.md say \`node bin/forge.js\`, use it instead. Do not ask questions; finish the task, then reply with a short final answer.`;

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
  const summary = { answer: '', isError: true, turns: null, durationMs: null, costUsd: null, tokens: null, toolCalls: { total: 0, forge: 0, otherBash: 0, native: {} }, forgeErrors: [] };
  for (const line of stream.split('\n')) {
    let event;
    try { event = record(JSON.parse(line)); } catch { continue; }
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

/** @param {string} executable @param {string[]} args @param {string} cwd @param {number} timeoutMs @returns {Promise<string>} */
function headless(executable, args, cwd, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    /** @type {Buffer[]} */ const stdout = [];
    /** @type {Buffer[]} */ const stderr = [];
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', status => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString('utf8');
      if (status !== 0 && !text.includes('"type":"result"')) reject(new Error(`${executable} exited ${status}: ${Buffer.concat(stderr).toString('utf8').slice(0, 2000)}`));
      else resolvePromise(text);
    });
  });
}

/**
 * Runs one task with Claude Code headless in a fresh fixture workspace whose `setup` installed the Forge skills
 * into `.claude/skills`, then evaluates the task's checks against the end state and the final answer. The agent
 * may run only the guarded Forge wrapper and the read-only native tools; `dontAsk` denies everything else.
 * @param {Task} task @param {ClaudeOptions} options @param {number} attempt @returns {Promise<ClaudeResult>}
 */
export async function runClaude(task, options, attempt) {
  const workspace = await createWorkspace(task, { distribution: options.distribution });
  const guard = await installGuard(workspace.root).catch(async error => { await workspace.dispose(); throw error; });
  try {
    const prompt = `${instructions(guard.command)}\n\n${await workspace.expand(task.prompt)}`;
    const args = [
      '-p', prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--setting-sources', 'project',
      '--permission-mode', 'dontAsk', '--max-turns', String(options.maxTurns), '--allowedTools', guard.allowedTool, ...options.allowedTools,
      ...(options.model ? ['--model', options.model] : []),
    ];
    let transcript, error;
    try { transcript = summarizeStream(await headless(options.executable, args, workspace.root, options.timeoutMs)); }
    catch (failure) { error = failure instanceof Error ? failure.message : String(failure); transcript = summarizeStream(''); }
    const checks = await evaluateChecks(workspace, task.checks, transcript.answer);
    return { id: task.id, driver: 'claude', attempt, passed: error === undefined && checks.every(check => check.passed), checks, transcript, ...(error ? { error } : {}) };
  } finally {
    await guard.dispose();
    await workspace.dispose();
  }
}
