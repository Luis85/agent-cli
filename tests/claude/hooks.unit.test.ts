import { describe, expect, it } from 'vitest';
import { claudeHookEvents, validateClaudeHooks } from '../../src/domain/claude-hooks.ts';

const configuration = (handler: unknown, event = 'PreToolUse') => ({ [event]: [{ matcher: 'Bash|Edit', hooks: [handler] }] });

describe('native Claude hook validation', () => {
  it('accepts all documented event and handler combinations without changing extension data', () => {
    const handlers = {
      command: { type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/check.js'], shell: 'powershell', async: false, asyncRewake: true },
      http: { type: 'http', url: 'http://localhost:8080/hooks', headers: { Authorization: 'Bearer $TOKEN' }, allowedEnvVars: ['TOKEN'] },
      mcp_tool: { type: 'mcp_tool', server: 'plugin:quality:checks', tool: 'inspect', input: { path: '${tool_input.file_path}', checks: ['types'], strict: true } },
      prompt: { type: 'prompt', prompt: 'Check $ARGUMENTS', model: 'haiku' },
      agent: { type: 'agent', prompt: 'Verify $ARGUMENTS', model: 'sonnet' },
    };
    for (const [event, types] of Object.entries(claudeHookEvents)) {
      const value = { [event]: [{ matcher: '', extension: { owner: 'team' }, hooks: types.map(type => ({ ...handlers[type], timeout: 1.5, statusMessage: 'Checking', once: true, extension: ['kept'] })) }] };
      const before = structuredClone(value);
      validateClaudeHooks(value);
      expect(value).toEqual(before);
    }
    expect(Object.keys(claudeHookEvents)).toHaveLength(33);
  });

  it('preserves shell syntax, permission expressions, matchers and placeholders as inert strings', () => {
    const value = configuration({ type: 'command', command: 'touch /tmp/never-execute; $(other-command)', if: 'Bash(git *)', args: [], timeout: 0 });
    expect(() => validateClaudeHooks(value)).not.toThrow();
    expect(value.PreToolUse?.[0]?.hooks[0]).toMatchObject({ command: 'touch /tmp/never-execute; $(other-command)' });
  });

  it('accepts omitted matchers, empty hook collections and ignored nonmatching event matchers', () => {
    for (const value of [{}, { Stop: [] }, { Stop: [{ hooks: [] }] }, configuration({ type: 'command', command: 'true' }, 'Stop')]) {
      expect(() => validateClaudeHooks(value)).not.toThrow();
    }
  });

  it.each([
    null, [], 'hooks', { TypoEvent: [] }, { PreToolUse: {} }, { Stop: [null] },
    { Stop: [{ matcher: false, hooks: [] }] }, { Stop: [{}] }, { Stop: [{ hooks: {} }] },
    { Stop: [undefined] }, { Stop: [{ hooks: Array(1) }] },
  ])('rejects malformed event/group configuration: %j', value => {
    expect(() => validateClaudeHooks(value)).toThrow(expect.objectContaining({ code: 'INVALID_CLAUDE_HOOKS' }));
  });

  it.each([
    null, {}, { type: 'unknown' }, { type: 'command' }, { type: 'command', command: '' },
    { type: 'command', command: 42 }, { type: 'command', command: 'true', args: 'arg' },
    { type: 'command', command: 'true', args: [42] }, { type: 'command', command: 'true', args: Array(1) },
    { type: 'command', command: 'true', shell: 'zsh' }, { type: 'command', command: 'true', async: 'yes' },
    { type: 'command', command: 'true', asyncRewake: 1 }, { type: 'command', command: 'true', once: 'yes' },
    { type: 'command', command: 'true', if: ['Bash(git *)'] }, { type: 'command', command: 'true', statusMessage: false },
    ...[-1, Infinity, NaN, '30', null].map(timeout => ({ type: 'command', command: 'true', timeout })),
    { type: 'prompt', prompt: '' }, { type: 'agent', prompt: 'check', model: 42 },
    { type: 'http', url: 'file:///tmp/hook' }, { type: 'http', url: '/relative' },
    { type: 'http', url: 'https://example.com', headers: { Authorization: 42 } },
    { type: 'http', url: 'https://example.com', allowedEnvVars: [null] },
    { type: 'http', url: 'https://example.com', async: true },
    { type: 'mcp_tool', server: 'tools' }, { type: 'mcp_tool', server: '', tool: 'check' },
    { type: 'mcp_tool', server: 'tools', tool: 'check', input: [] },
  ])('rejects malformed handlers with their configuration location: %j', value => {
    expect(() => validateClaudeHooks(configuration(value))).toThrow(expect.objectContaining({ code: 'INVALID_CLAUDE_HOOKS', message: expect.stringContaining('hooks.PreToolUse[0].hooks[0]') }));
  });

  it.each([
    ['SessionStart', { type: 'http', url: 'https://example.com' }],
    ['Setup', { type: 'prompt', prompt: 'check' }],
    ['PermissionRequest', { type: 'agent', prompt: 'check' }],
    ['Notification', { type: 'prompt', prompt: 'check' }],
    ['PreModelSwitch', { type: 'agent', prompt: 'check' }],
  ])('rejects unsupported handlers on %s instead of silently configuring a skipped hook', (event, value) => {
    expect(() => validateClaudeHooks(configuration(value, event as string))).toThrow(expect.objectContaining({ code: 'INVALID_CLAUDE_HOOKS' }));
  });
});
