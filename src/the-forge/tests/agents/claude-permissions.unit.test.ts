import { describe, expect, it } from 'vitest';
import type { AgentDiagnostic } from '../../src/plugins/agents/domain/config.ts';
import { isBroadRule, reviewedRules, serverNames, topLevelRules, type PermissionRule } from '../../src/plugins/agents/domain/claude-permissions.ts';
import type { McpMode } from '../../src/plugins/agents/domain/claude-execution.ts';
import type { McpServer } from '../../src/plugins/agents/domain/claude-mcp.ts';

/** The rules and diagnostics of one top-level `permissions` list. */
function mapped(list: 'allow' | 'ask' | 'deny', patterns: string[], mode: McpMode = 'inline', servers: Record<string, string[]> = { github: ['github'] }) {
  return topLevelRules({ permissions: { [list]: patterns } }, new Map(Object.entries(servers)), mode);
}
const unsupported = (diagnostics: AgentDiagnostic[]) => diagnostics.filter(entry => entry.code === 'permission-unsupported');

describe('broad rules', () => {
  it.each(['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'Bash()', 'Bash( * )', 'mcp__github', 'mcp__my_server', 'mcp__my_mcp_server__*'])('treats %s as broad', rule => {
    expect(isBroadRule(rule)).toBe(true);
  });

  it.each(['Bash(:*)', 'Bash(*:*)', 'Bash(* --version)', 'Bash(sh -c *)', 'Bash(bash *)', 'Bash(bash:*)', 'Bash(/bin/zsh -lc:*)', 'Bash(env *)',
    'Bash(env FOO=1 *)', 'Bash(xargs:*)', 'Bash(sudo *)', 'Bash(node -e *)', 'Bash(node:*)', 'Bash(python3 -c *)', 'Bash(python3.12 -c *)', 'Bash(npx *)', 'Bash(pwsh.exe -Command *)'])('treats the command-wide %s as broad', rule => {
    expect(isBroadRule(rule)).toBe(true);
  });

  it.each(['Bash(git *)', 'Bash(npm run test:*)', 'Bash(bash scripts/check.sh *)', 'Bash(node scripts/build.mjs *)', 'Bash(git commit -m *)', 'Bash(bash -c ls)', 'Bash(environment-check *)'])('keeps the command-specific %s narrow', rule => {
    expect(isBroadRule(rule)).toBe(false);
  });

  it.each(['NotBash(*)', 'Bash(*)x', 'Bash(ls)', 'xmcp__github', 'mcp__github__get_issue', 'mcp__my_server__get', 'mcp__', 'Read', 'Edit(./docs/**)'])('treats %s as narrow', rule => {
    expect(isBroadRule(rule)).toBe(false);
  });
});

describe('top-level docker-agent permissions', () => {
  it('maps nothing and reports nothing without permissions', () => {
    expect(topLevelRules({}, new Map(), 'inline')).toStrictEqual({ rules: [], diagnostics: [] });
    expect(topLevelRules({ permissions: { allow: [] } }, new Map(), 'inline')).toStrictEqual({ rules: [], diagnostics: [] });
  });

  it('warns once per non-empty list that argument matching is approximated', () => {
    const { diagnostics } = topLevelRules({ permissions: { allow: ['read_file'], ask: [], deny: ['shell:cmd=rm *'] } }, new Map(), 'none');
    expect(diagnostics.filter(entry => entry.code === 'permission-approximated')).toStrictEqual([
      { severity: 'warning', code: 'permission-approximated', pointer: '/permissions/allow', message: 'permissions.allow becomes Claude permission rules in .claude/settings.json; argument matching is approximated.', fidelity: 'A' },
      { severity: 'warning', code: 'permission-approximated', pointer: '/permissions/deny', message: 'permissions.deny becomes Claude permission rules in .claude/settings.json; argument matching is approximated.', fidelity: 'A' },
    ]);
  });

  it.each([
    ['*_directory', ['Glob'], 'The allow pattern *_directory matches create_directory, remove_directory, which have no Claude permission rule of the same reach; only Glob is emitted.'],
    ['*_task', ['TaskCreate', 'TaskGet', 'TaskUpdate'], 'The allow pattern *_task matches next_task, delete_task, which have no Claude permission rule of the same reach; only TaskCreate, TaskGet, TaskUpdate is emitted.'],
  ])('emits the mapped rules of the partly mapped pattern %s and names the tools it leaves out', (pattern, emitted, message) => {
    const { rules, diagnostics } = mapped('allow', [pattern]);
    expect(rules).toStrictEqual(emitted.map(rule => ({ list: 'allow', rule, at: '/permissions/allow/0' })));
    expect(unsupported(diagnostics)).toStrictEqual([{ severity: 'info', code: 'permission-unsupported', pointer: '/permissions/allow/0', fidelity: 'U', message }]);
  });

  it.each<[string, 'allow' | 'ask' | 'deny', string, McpMode, string[], string]>([
    ['a single unmapped tool', 'deny', 'think', 'inline', [], 'warning The deny pattern think matches think, which has no Claude permission rule of the same reach; it is not emitted.'],
    ['regex characters literally', 'allow', 'read_file.', 'inline', [], 'info The allow pattern read_file. names no docker-agent built-in tool with a Claude permission rule; it is not emitted.'],
    ['an unknown MCP server', 'ask', 'mcp:unknown:*', 'inline', [], 'warning The ask pattern mcp:unknown:* names the MCP server unknown, which no generated agent defines; it is not emitted.'],
    ['an MCP pattern without MCP servers', 'allow', 'mcp:github:*', 'none', [], 'info The allow pattern mcp:github:* names an MCP server, and no MCP server is generated without --mcp inline or --mcp project; it is not emitted.'],
    ['a prefixed shell pattern as arguments', 'allow', 'xshell:cmd=ls', 'inline', [], 'info The allow pattern xshell:cmd=ls matches tool arguments, which Claude permission rules express only for shell commands; it is not emitted.'],
    ['a prefixed MCP pattern as arguments', 'allow', 'xmcp:github:get', 'inline', [], 'info The allow pattern xmcp:github:get matches tool arguments, which Claude permission rules express only for shell commands; it is not emitted.'],
  ])('reports %s', (_name, list, pattern, mode, rules, finding) => {
    const result = mapped(list, [pattern], mode);
    expect(result.rules.map(entry => entry.rule)).toStrictEqual(rules);
    expect(unsupported(result.diagnostics).map(entry => `${entry.severity} ${entry.message}`)).toStrictEqual([finding]);
  });

  it.each([
    ['read_file', 'Read'], ['read_multiple_files', 'Read'], ['list_directory', 'Glob'], ['directory_tree', 'Glob'], ['search_files_content', 'Grep'],
    ['write_file', 'Write'], ['edit_file', 'Edit'], ['shell', 'Bash'], ['fetch', 'WebFetch'], ['user_prompt', 'AskUserQuestion'],
    ['create_todo', 'TaskCreate'], ['create_todos', 'TaskCreate'], ['update_todos', 'TaskUpdate'], ['list_todos', 'TaskList'],
    ['create_task', 'TaskCreate'], ['get_task', 'TaskGet'], ['list_tasks', 'TaskList'], ['update_task', 'TaskUpdate'],
  ])('maps the built-in tool %s to the Claude rule %s', (tool, rule) => {
    const { rules, diagnostics } = mapped('deny', [tool]);
    expect(rules).toStrictEqual([{ list: 'deny', rule, at: '/permissions/deny/0' }]);
    expect(unsupported(diagnostics)).toStrictEqual([]);
  });

  it.each(['create_directory', 'remove_directory', 'next_task', 'delete_task', 'add_dependency', 'remove_dependency', 'think'])('never widens the built-in tool %s to a rule', tool => {
    const { rules, diagnostics } = mapped('deny', [tool]);
    expect(rules).toStrictEqual([]);
    expect(unsupported(diagnostics).map(entry => entry.message)).toStrictEqual([`The deny pattern ${tool} matches ${tool}, which has no Claude permission rule of the same reach; it is not emitted.`]);
  });

  it('maps shell and MCP patterns to rules per generated server name', () => {
    const server = (name: string): McpServer => ({ name, declared: 'github', at: '/agents/a/toolsets/0', config: {} });
    const servers = serverNames([{ servers: [server('github'), server('github-2')] }, { servers: [server('github')] }]);
    expect(servers).toStrictEqual(new Map([['github', ['github', 'github-2']]]));
    const { rules, diagnostics } = topLevelRules({ permissions: { allow: ['shell:cmd=git *', 'mcp:github:get_issue', 'mcp:github:*'] } }, servers, 'project');
    expect(rules.map(entry => entry.rule)).toStrictEqual(['Bash(git *)', 'mcp__github__get_issue', 'mcp__github-2__get_issue', 'mcp__github', 'mcp__github-2']);
    expect(unsupported(diagnostics)).toStrictEqual([]);
  });
});

describe('reviewed rules', () => {
  const rule = (list: PermissionRule['list'], value: string): PermissionRule => ({ list, rule: value, at: `/permissions/${list}/0` });

  it('keeps broad deny and ask rules without --allow-broad-permissions as plain grants', () => {
    const diagnostics: AgentDiagnostic[] = [];
    expect(reviewedRules([rule('deny', 'Bash'), rule('ask', 'WebFetch')], false, diagnostics)).toStrictEqual([rule('deny', 'Bash'), rule('ask', 'WebFetch')]);
    expect(diagnostics).toStrictEqual([
      { severity: 'warning', code: 'grants-permission', pointer: '/permissions/deny/0', message: '.claude/settings.json permissions.deny gets the rule Bash.' },
      { severity: 'warning', code: 'grants-permission', pointer: '/permissions/ask/0', message: '.claude/settings.json permissions.ask gets the rule WebFetch.' },
    ]);
  });

  it('drops a broad allow rule unless allowed, and marks an allowed one as broad', () => {
    const refused: AgentDiagnostic[] = [];
    expect(reviewedRules([rule('allow', 'Write'), rule('allow', 'Read')], false, refused)).toStrictEqual([rule('allow', 'Read')]);
    expect(refused.map(entry => `${entry.severity} ${entry.code} ${entry.message}`)).toStrictEqual([
      'error broad-permission The rule Write would auto-approve every use of its tool; pass --allow-broad-permissions to write it to permissions.allow, or narrow the docker-agent pattern.',
      'warning grants-permission .claude/settings.json permissions.allow gets the rule Read.',
    ]);
    const allowed: AgentDiagnostic[] = [];
    expect(reviewedRules([rule('allow', 'Write')], true, allowed)).toHaveLength(1);
    expect(allowed.map(entry => entry.message)).toStrictEqual(['.claude/settings.json permissions.allow gets the rule Write (broad, allowed by --allow-broad-permissions).']);
  });
});
