import { diagnostic, pointer, record, stringList, type AgentConfigDocument, type AgentDiagnostic } from './config.ts';
import type { McpServer } from './claude-mcp.ts';
import type { McpMode } from './claude-execution.ts';
import { say } from './messages.ts';

/** One Claude permission rule for `.claude/settings.json`, with the JSON pointer of the docker-agent setting it comes from. */
export interface PermissionRule { list: 'allow' | 'ask' | 'deny'; rule: string; at: string }

/**
 * docker-agent built-in tool → the Claude tool its permission maps to. Only tools whose Claude rule covers the same
 * operation are listed: `create_directory`, `remove_directory`, task dependencies and deletions have no Claude rule
 * of the same reach and are never widened to one (such as `Bash`).
 */
const permissionTools: Readonly<Record<string, string>> = {
  read_file: 'Read', read_multiple_files: 'Read', list_directory: 'Glob', directory_tree: 'Glob', search_files_content: 'Grep',
  write_file: 'Write', edit_file: 'Edit', shell: 'Bash', fetch: 'WebFetch', user_prompt: 'AskUserQuestion',
  create_todo: 'TaskCreate', create_todos: 'TaskCreate', update_todos: 'TaskUpdate', list_todos: 'TaskList',
  create_task: 'TaskCreate', get_task: 'TaskGet', list_tasks: 'TaskList', update_task: 'TaskUpdate',
};
/** docker-agent built-in tool names without a Claude permission rule of the same reach. */
const unmappedTools = ['create_directory', 'remove_directory', 'next_task', 'delete_task', 'add_dependency', 'remove_dependency', 'think'];
const knownTools = [...Object.keys(permissionTools), ...unmappedTools];

/** Programs that run whatever command or code follows them, so a wildcard after them approves any command. */
const wrappers = new Set(['env', 'xargs', 'sudo', 'doas', 'su', 'eval', 'exec', 'nohup', 'time', 'timeout', 'nice', 'command', 'builtin', 'npx', 'bunx', 'pnpx']);
/** Shells and interpreters: broad with a wildcard after the program or its options (`sh -c *`), not after a script. */
const interpreters = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'pwsh', 'powershell', 'cmd',
  'node', 'deno', 'bun', 'python', 'perl', 'ruby', 'php', 'osascript']);

/**
 * Whether a `Bash(...)` pattern approves arbitrary commands: an empty pattern, a wildcard with no command before it
 * (`*`, `:*`), or a wildcard after a wrapper (`env *`) or after a shell or interpreter and only its options
 * (`bash:*`, `sh -c *`, `node -e *`). A wildcard after an ordinary command (`git *`) or a script stays narrow.
 */
function broadCommand(pattern: string): boolean {
  if (pattern.trim() === '') return true;
  const wildcard = pattern.indexOf('*');
  if (wildcard === -1) return false;
  const words = pattern.slice(0, wildcard).trim().replace(/:$/, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const program = words[0]!.split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, '').replace(/[\d.]+$/, '');
  if (wrappers.has(program)) return true;
  return interpreters.has(program) && words.slice(1).every(word => word.startsWith('-'));
}

/**
 * Claude rules that auto-approve a whole tool: every command (also through a shell, interpreter or wrapper), every
 * file edit, any URL or every tool of an MCP server. They are written to `permissions.allow` only with
 * `--allow-broad-permissions`.
 */
export function isBroadRule(rule: string): boolean {
  if (['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch'].includes(rule)) return true;
  const bash = /^Bash\((.*)\)$/s.exec(rule);
  if (bash) return broadCommand(bash[1]!);
  return /^mcp__[^_]+(?:_[^_]+)*(?:__\*)?$/.test(rule);
}

const globSource = (glob: string) => `^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`;

interface Mapped { rules: string[]; reason?: string }

function builtinRules(pattern: string): Mapped {
  const expression = new RegExp(globSource(pattern)), matched = knownTools.filter(name => expression.test(name));
  const rules = [...new Set(matched.flatMap(name => permissionTools[name] ? [permissionTools[name]] : []))];
  if (matched.length === 0) return { rules, reason: say('reasonNoBuiltin') };
  const unmapped = matched.filter(name => !permissionTools[name]);
  return { rules, ...(unmapped.length > 0 ? { reason: say(unmapped.length === 1 ? 'reasonUnmappedOne' : 'reasonUnmapped', { tools: unmapped.join(', ') }) } : {}) };
}

function mcpRules(server: string, tool: string, servers: ReadonlyMap<string, readonly string[]>, mode: McpMode): Mapped {
  if (mode === 'none') return { rules: [], reason: say('reasonMcpNone') };
  const names = servers.get(server);
  if (!names) return { rules: [], reason: say('reasonMcpUnknown', { server }) };
  return { rules: names.map(name => tool === '*' ? `mcp__${name}` : `mcp__${name}__${tool}`) };
}

/** Claude rules for one docker-agent permission pattern; `reason` says what is not emitted. */
function patternRules(pattern: string, servers: ReadonlyMap<string, readonly string[]>, mode: McpMode): Mapped {
  const shell = /^shell:cmd=(.+)$/.exec(pattern);
  if (shell) return { rules: [`Bash(${shell[1]})`] };
  const mcp = /^mcp:([^:]+):(.+)$/.exec(pattern);
  if (mcp) return mcpRules(mcp[1]!, mcp[2]!, servers, mode);
  if (pattern.includes(':')) return { rules: [], reason: say('reasonArguments') };
  return builtinRules(pattern);
}

/** Generated MCP server names by the name docker-agent permissions use (`mcp:<declared>:<tool>`). */
export function serverNames(drafts: ReadonlyArray<{ servers: readonly McpServer[] }>): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const server of drafts.flatMap(draft => draft.servers)) names.set(server.declared, [...new Set([...(names.get(server.declared) ?? []), server.name])]);
  return names;
}

/**
 * Top-level docker-agent `permissions` as Claude rules. Rules use the generated MCP server names; patterns without a
 * Claude rule of the same reach are reported (a warning for lost deny rules), never widened.
 */
export function topLevelRules(config: AgentConfigDocument, servers: ReadonlyMap<string, readonly string[]>, mode: McpMode): { rules: PermissionRule[]; diagnostics: AgentDiagnostic[] } {
  const rules: PermissionRule[] = [], diagnostics: AgentDiagnostic[] = [];
  for (const list of ['allow', 'ask', 'deny'] as const) {
    const patterns = stringList(record(config.permissions)[list]);
    patterns.forEach((pattern, index) => {
      const at = pointer('permissions', list, index), mapped = patternRules(pattern, servers, mode);
      if (mapped.reason) diagnostics.push(diagnostic(list === 'allow' ? 'info' : 'warning', 'permission-unsupported', at, mapped.rules.length > 0 ? say('permissionPartial', { list, pattern, reason: mapped.reason, rules: mapped.rules.join(', ') }) : say('permissionDropped', { list, pattern, reason: mapped.reason }), 'U'));
      rules.push(...mapped.rules.map(rule => ({ list, rule, at })));
    });
    if (patterns.length > 0) diagnostics.push(diagnostic('warning', 'permission-approximated', pointer('permissions', list), say('permissionApproximated', { list }), 'A'));
  }
  return { rules, diagnostics };
}

/**
 * The rules written to settings: broad allow rules need `allowBroad` (otherwise an error diagnostic and the rule is
 * dropped), and every written rule is listed as `grants-permission`.
 */
export function reviewedRules<Rule extends PermissionRule>(rules: readonly Rule[], allowBroad: boolean, diagnostics: AgentDiagnostic[]): Rule[] {
  return rules.filter(entry => {
    if (entry.list === 'allow' && isBroadRule(entry.rule) && !allowBroad) {
      diagnostics.push(diagnostic('error', 'broad-permission', entry.at, say('broadPermission', { rule: entry.rule })));
      return false;
    }
    diagnostics.push(diagnostic('warning', 'grants-permission', entry.at, say(entry.list === 'allow' && isBroadRule(entry.rule) ? 'grantsPermissionBroad' : 'grantsPermission', { list: entry.list, rule: entry.rule })));
    return true;
  });
}
