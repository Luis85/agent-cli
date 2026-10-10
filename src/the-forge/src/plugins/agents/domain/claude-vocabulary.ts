/**
 * Names shared by docker-agent and Claude Code: built-in tools, hook events and agent names. Tool names follow
 * docker-agent `pkg/tools/builtin` at the vendored commit and the Claude Code tool list of October 2026.
 */
export const filesystemTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep'] as const;
export const readOnlyFilesystemTools = ['Read', 'Glob', 'Grep'] as const;
export const writeTools = ['Write', 'Edit', 'NotebookEdit'] as const;
export const taskTools = ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate'] as const;

/** docker-agent built-in tool name → Claude Code tool. */
const builtinTools: Readonly<Record<string, string>> = {
  read_file: 'Read', read_multiple_files: 'Read', write_file: 'Write', edit_file: 'Edit',
  list_directory: 'Glob', directory_tree: 'Glob', search_files_content: 'Grep',
  shell: 'Bash', fetch: 'WebFetch', user_prompt: 'AskUserQuestion',
  create_todo: 'TaskCreate', create_todos: 'TaskCreate', update_todos: 'TaskUpdate', list_todos: 'TaskList',
  create_task: 'TaskCreate', get_task: 'TaskGet', list_tasks: 'TaskList', update_task: 'TaskUpdate', next_task: 'TaskGet', delete_task: 'TaskUpdate',
  add_dependency: 'TaskUpdate', remove_dependency: 'TaskUpdate',
};

/** docker-agent hook event → Claude Code hook event, where one exists. */
export const hookEvents: Readonly<Record<string, string>> = {
  pre_tool_use: 'PreToolUse', post_tool_use: 'PostToolUse', permission_request: 'PermissionRequest', session_start: 'SessionStart',
  user_prompt_submit: 'UserPromptSubmit', session_end: 'SessionEnd', pre_compact: 'PreCompact', before_compaction: 'PreCompact',
  after_compaction: 'PostCompact', subagent_stop: 'SubagentStop', stop: 'Stop', notification: 'Notification', worktree_create: 'WorktreeCreate',
};
/** Claude hook events whose matcher selects tools. */
export const toolMatcherEvents: readonly string[] = ['PreToolUse', 'PostToolUse', 'PermissionRequest'];

/**
 * A Claude agent and skill name: lowercase letters, digits and hyphens, as Claude Code documents for agent names.
 * Underscores, spaces and other characters become hyphens.
 */
export function claudeName(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return sanitized === '' ? 'agent' : sanitized;
}

/** The Claude model alias of an Anthropic model id, if its family has one. */
export function modelAlias(id: string): string | undefined {
  return ['opus', 'sonnet', 'haiku', 'fable'].find(family => new RegExp(`(?:^|[-.])${family}(?:$|[-.])`).test(id));
}

/** Each alias names the newest model of its family that the vendored docker-agent examples use. */
export const aliasModels: Readonly<Record<string, string>> = { opus: 'claude-opus-5', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5', fable: 'claude-fable-5-1' };

const globSource = (glob: string) => `^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`;

/** The Claude tools a docker-agent tool name or glob (`read_*`) selects among the known built-in tools. */
export function claudeToolsFor(pattern: string): string[] {
  const expression = new RegExp(globSource(pattern));
  return [...new Set(Object.entries(builtinTools).filter(([name]) => expression.test(name)).map(([, tool]) => tool))];
}

/**
 * Translates a docker-agent tool matcher (a regular expression over tool names such as `shell|edit_file`, or `*`)
 * to Claude tool names. Alternatives without a known equivalent are returned in `unknown` and kept literally.
 */
export function translateMatcher(matcher: string): { matcher: string; unknown: string[] } {
  if (matcher === '' || matcher === '*' || matcher === '.*') return { matcher: '*', unknown: [] };
  const unknown: string[] = [], translated: string[] = [];
  for (const alternative of matcher.split('|')) {
    const tools = /^[a-z_*]+$/.test(alternative) ? claudeToolsFor(alternative) : [];
    if (tools.length === 0) { unknown.push(alternative); translated.push(alternative); }
    else translated.push(...tools);
  }
  return { matcher: [...new Set(translated)].join('|'), unknown };
}
