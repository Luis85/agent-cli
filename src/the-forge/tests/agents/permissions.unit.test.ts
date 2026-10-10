import { describe, expect, it } from 'vitest';
import { generateClaude, type ClaudeGenerationOptions } from '../../src/plugins/agents/domain/claude-generation.ts';
import { isBroadRule } from '../../src/plugins/agents/domain/claude-permissions.ts';

/** Permission rules grant auto-approval: they are written only with --settings, never widened, and always listed. */
const options: ClaudeGenerationOptions = { mcp: 'none', hooks: false, settings: true, commands: false, modelStyle: 'id' };
const agent = (extra: Record<string, unknown> = {}) => ({ model: 'anthropic/claude-sonnet-5', description: 'Helps.', instruction: 'Help.', ...extra });
const generate = (config: Record<string, unknown>, extra: Partial<ClaudeGenerationOptions> = {}) =>
  generateClaude([{ path: 'agents/team.yaml', sourceHash: 'a'.repeat(64), config, instructions: {} }], { ...options, ...extra });
const findings = (output: ReturnType<typeof generate>, code: string) => output.diagnostics.filter(entry => entry.code === code).map(entry => `${entry.severity} ${entry.pointer} ${entry.message}`);

describe('toolset restrictions', () => {
  it('never turns filesystem allow_list or fetch allowed_domains into allow rules, and keeps deny lists as deny rules', () => {
    const output = generate({ agents: { a: agent({ toolsets: [
      { type: 'filesystem', allow_list: ['docs', '/tmp/x'], deny_list: ['secrets', '/etc', '~/.ssh'] },
      { type: 'fetch', blocked_domains: ['evil.example', '*.ads.example', '10.0.0.0/8'] },
    ] }), b: agent({ toolsets: [{ type: 'fetch', allowed_domains: ['docs.docker.com'] }] }) } });
    expect(output.settings!.permissions).toEqual({
      allow: [], ask: [],
      deny: ['Read(./secrets/**)', 'Edit(./secrets/**)', 'Read(//etc/**)', 'Edit(//etc/**)', 'Read(~/.ssh/**)', 'Edit(~/.ssh/**)', 'WebFetch(domain:evil.example)', 'WebFetch(domain:*.evil.example)', 'WebFetch(domain:*.ads.example)'],
    });
    expect(output.diagnostics.filter(entry => entry.code === 'restriction-unsupported').map(entry => [entry.severity, entry.pointer, entry.fidelity])).toEqual([
      ['warning', '/agents/a/toolsets/0/allow_list', 'U'], ['warning', '/agents/b/toolsets/0/allowed_domains', 'U'],
    ]);
    expect(findings(output, 'grants-permission')).toContain('warning /agents/a/toolsets/0/deny_list .claude/settings.json permissions.deny gets the rule Read(./secrets/**).');
  });
});

describe('top-level permissions', () => {
  const permissions = {
    allow: ['shell:cmd=git status*', 'read_*', 'create_directory', 'list_*', 'go_diagnostics', 'edit_file:path=/etc/*', 'mcp:github:get_issue', 'mcp:github:*'],
    ask: ['fetch'],
    deny: ['shell:cmd=rm -rf*', 'remove_directory', 'edit_file:path=/etc/*'],
  };
  const team = { permissions, agents: { root: agent({ toolsets: [{ type: 'mcp', name: 'github', command: 'gh-mcp' }, { type: 'mcp', name: 'github', command: 'gh-mcp', args: ['--other'] }] }) } };

  it('maps narrow patterns to narrow rules and never widens unmappable ones', () => {
    const output = generate(team, { mcp: 'inline', allowBroadPermissions: true });
    expect(output.settings!.permissions).toEqual({
      allow: ['Bash(git status*)', 'Read', 'Glob', 'TaskList', 'mcp__github__get_issue', 'mcp__github-2__get_issue', 'mcp__github', 'mcp__github-2'],
      ask: ['WebFetch'],
      deny: ['Bash(rm -rf*)'],
    });
    expect(findings(output, 'permission-unsupported')).toEqual([
      'info /permissions/allow/2 The allow pattern create_directory matches create_directory, which has no Claude permission rule of the same reach; it is not emitted.',
      'info /permissions/allow/4 The allow pattern go_diagnostics names no docker-agent built-in tool with a Claude permission rule; it is not emitted.',
      'info /permissions/allow/5 The allow pattern edit_file:path=/etc/* matches tool arguments, which Claude permission rules express only for shell commands; it is not emitted.',
      'warning /permissions/deny/1 The deny pattern remove_directory matches remove_directory, which has no Claude permission rule of the same reach; it is not emitted.',
      'warning /permissions/deny/2 The deny pattern edit_file:path=/etc/* matches tool arguments, which Claude permission rules express only for shell commands; it is not emitted.',
    ]);
    expect(findings(output, 'grants-permission')).toEqual(expect.arrayContaining([
      'warning /permissions/allow/0 .claude/settings.json permissions.allow gets the rule Bash(git status*).',
      'warning /permissions/allow/7 .claude/settings.json permissions.allow gets the rule mcp__github (broad, allowed by --allow-broad-permissions).',
      'warning /permissions/deny/0 .claude/settings.json permissions.deny gets the rule Bash(rm -rf*).',
    ]));
    expect(findings(output, 'grants-permission')).toHaveLength(10);
  });

  it('refuses broad allow rules without --allow-broad-permissions and does not write them', () => {
    const output = generate({ permissions: { allow: ['*', 'shell:cmd=*', 'write_file', 'shell:cmd=ls'] }, agents: { root: agent() } });
    expect(output.settings!.permissions.allow).toEqual(['Read', 'Glob', 'Grep', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'Bash(ls)']);
    expect(output.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.pointer} ${entry.message.split(' would')[0]}`)).toEqual([
      'broad-permission /permissions/allow/0 The rule Write', 'broad-permission /permissions/allow/0 The rule Edit', 'broad-permission /permissions/allow/0 The rule Bash',
      'broad-permission /permissions/allow/0 The rule WebFetch', 'broad-permission /permissions/allow/1 The rule Bash(*)', 'broad-permission /permissions/allow/2 The rule Write',
    ]);
  });

  it('omits MCP rules when no MCP server is generated and reports the reason', () => {
    const output = generate(team);
    expect(output.settings!.permissions.allow).not.toContain('mcp__github');
    expect(findings(output, 'permission-unsupported')).toContain('info /permissions/allow/6 The allow pattern mcp:github:get_issue names an MCP server, and no MCP server is generated without --mcp inline or --mcp project; it is not emitted.');
  });

  it('writes no rule without --settings', () => {
    const output = generate(team, { settings: false });
    expect(output.settings).toBeUndefined();
    expect(findings(output, 'grants-permission')).toEqual([]);
    expect(output.diagnostics.map(entry => entry.code)).toContain('permissions-not-generated');
  });

  it('classifies whole-tool rules as broad', () => {
    expect(['Bash', 'Bash(*)', 'Bash( * )', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'mcp__github', 'mcp__git-hub__*'].every(isBroadRule)).toBe(true);
    expect(['Bash(git *)', 'Read', 'WebFetch(domain:docs.docker.com)', 'mcp__github__get_issue', 'Edit(./docs/**)', 'TaskList'].some(isBroadRule)).toBe(false);
  });
});
