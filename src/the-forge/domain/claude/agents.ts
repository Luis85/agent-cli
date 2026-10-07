import { AppError, ensure, isRecord } from '../shared/errors.ts';
import { validateClaudeHooks } from './hooks.ts';

/** Native Claude Code frontmatter stays extensible; omitted capabilities stay omitted. */
export interface ClaudeAgentDocument { metadata: Record<string, unknown>; prompt: string }

function valid(condition: unknown, message: string): asserts condition {
  ensure(condition, 'INVALID_CLAUDE_AGENT', message);
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(nonempty); }

function nativeValue(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  valid(depth < 100, 'Agent metadata is nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { valid(Number.isFinite(value), 'Agent metadata numbers must be finite.'); return; }
  valid(typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'Agent metadata must contain JSON-compatible values.');
  valid(!ancestors.has(value), 'Agent metadata must not contain cyclic references.');
  ancestors.add(value);
  for (const child of Object.values(value)) nativeValue(child, ancestors, depth + 1);
  ancestors.delete(value);
}

function stringMap(value: unknown, field: string): void {
  valid(isRecord(value) && Object.values(value).every(entry => typeof entry === 'string'), `${field} must map names to strings.`);
}

function mcpServers(value: unknown): void {
  valid(Array.isArray(value), 'mcpServers must be a list of server names or inline server definitions.');
  for (const entry of value) {
    if (nonempty(entry)) continue;
    valid(isRecord(entry) && Object.keys(entry).length > 0, 'Inline MCP entries must map server names to configurations.');
    for (const [name, config] of Object.entries(entry)) {
      valid(nonempty(name) && isRecord(config), 'Inline MCP servers require a name and configuration mapping.');
      const type = config.type ?? 'stdio';
      valid(typeof type === 'string' && ['stdio', 'http', 'sse', 'ws'].includes(type), `MCP server ${name} has an unsupported transport.`);
      if (type === 'stdio') {
        valid(nonempty(config.command), `MCP server ${name} requires a command.`);
        if (config.args !== undefined) valid(Array.isArray(config.args) && config.args.every(arg => typeof arg === 'string'), `MCP server ${name} args must be strings.`);
      } else valid(nonempty(config.url), `MCP server ${name} requires a URL.`);
      for (const field of ['env', 'headers']) if (config[field] !== undefined) stringMap(config[field], `MCP server ${name} ${field}`);
    }
  }
}

/** Validate documented native fields without resolving tools, skills, models or servers. */
export function validateClaudeAgent(metadata: unknown, prompt: unknown): asserts metadata is Record<string, unknown> {
  valid(isRecord(metadata), 'Agent frontmatter must be a mapping.');
  nativeValue(metadata);
  valid(nonempty(metadata.name) && metadata.name.length <= 256 && !metadata.name.startsWith('-') && !metadata.name.includes(':'), 'Agent name must be nonempty, at most 256 characters, and contain neither a leading hyphen nor a colon.');
  valid(nonempty(metadata.description), 'Agent description must be a nonempty string.');
  valid(typeof prompt === 'string', 'Agent prompt must be Markdown text.');
  for (const field of ['tools', 'disallowedTools']) if (metadata[field] !== undefined) {
    valid(typeof metadata[field] === 'string' || strings(metadata[field]), `${field} must be a comma-separated string or a list of tool names.`);
  }
  if (metadata.model !== undefined) valid(nonempty(metadata.model), 'model must be a model alias, model ID, or inherit.');
  if (metadata.skills !== undefined) valid(strings(metadata.skills), 'skills must be a list of skill names.');
  if (metadata.maxTurns !== undefined) valid(Number.isSafeInteger(metadata.maxTurns) && Number(metadata.maxTurns) > 0, 'maxTurns must be a positive integer.');
  for (const field of ['background', 'omitClaudeMd']) if (metadata[field] !== undefined) valid(typeof metadata[field] === 'boolean', `${field} must be a boolean.`);
  const choices = {
    permissionMode: ['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan', 'manual'],
    memory: ['user', 'project', 'local'], effort: ['low', 'medium', 'high', 'xhigh', 'max'],
    isolation: ['worktree'], color: ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'],
  };
  for (const [field, allowed] of Object.entries(choices)) if (metadata[field] !== undefined) {
    valid(typeof metadata[field] === 'string' && allowed.includes(metadata[field]), `${field} must be one of: ${allowed.join(', ')}.`);
  }
  if (metadata.initialPrompt !== undefined) valid(typeof metadata.initialPrompt === 'string', 'initialPrompt must be a string.');
  if (metadata.experimental !== undefined) {
    valid(isRecord(metadata.experimental), 'experimental must be a mapping.');
    if (metadata.experimental.cacheTtl !== undefined) valid(typeof metadata.experimental.cacheTtl === 'string' && ['5m', '1h'].includes(metadata.experimental.cacheTtl), 'experimental.cacheTtl must be 5m or 1h.');
  }
  if (metadata.mcpServers !== undefined) mcpServers(metadata.mcpServers);
  if (metadata.hooks !== undefined) {
    try { validateClaudeHooks(metadata.hooks); }
    catch (error) { throw new AppError('INVALID_CLAUDE_AGENT', `Agent hooks: ${error instanceof Error ? error.message : 'Invalid hooks.'}`, 2); }
  }
}
