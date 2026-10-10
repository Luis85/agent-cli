import { describe, expect, it } from 'vitest';
import { claudePluginCapabilities, validateClaudePlugin } from '../../src/domain/claude/plugins.ts';

describe('native Claude plugin manifest', () => {
  it('accepts name-only manifests and non-semver versions without mutating extensions', () => {
    const manifest = { name: 'review-kit', version: 'rolling-october', futureComponent: { enabled: true }, metadata: { catalog: 123 } };
    const before = structuredClone(manifest);
    validateClaudePlugin(manifest);
    expect(manifest).toEqual(before);
    expect(() => validateClaudePlugin({ name: 'review-kit' })).not.toThrow();
  });

  it('rejects unknown-field values that would be silently lost in a JSON round trip', () => {
    for (const future of [undefined, NaN, Infinity, new Date(), () => true]) {
      expect(() => validateClaudePlugin({ name: 'review-kit', future })).toThrowError(expect.objectContaining({ code: 'INVALID_CLAUDE_PLUGIN' }));
    }
    const circular: Record<string, unknown> = { name: 'review-kit' };
    circular.future = circular;
    expect(() => validateClaudePlugin(circular)).toThrow(/circular/);
  });

  it('supports all documented component forms and preserves nested extensions', () => {
    const manifest = {
      name: 'review-kit', displayName: 'Review Kit', description: 'Review local changes',
      author: { name: 'Team', email: 'team@example.com', url: 'https://example.com' },
      homepage: 'https://example.com/review', repository: 'owner/repository', license: 'MIT', keywords: ['review'],
      icon: './icon.svg', documentationUrl: 'https://example.com/docs', defaultEnabled: false,
      dependencies: ['formatter', 'policy@company', { name: 'checker', marketplace: 'team', version: '^2.1' }],
      skills: ['.', './extra-skills/'], agents: ['./agents/reviewer.md'], outputStyles: './styles/',
      workflows: ['./workflows/', './workflow.js'], types: './state.d.ts',
      commands: {
        file: { source: './commands/file.md', argumentHint: '[path]', allowedTools: ['Read'] },
        inline: { content: 'Review the change.', description: 'Review', model: 'sonnet' },
      },
      hooks: ['./hooks/extra.json', { PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'format' }] }] }],
      mcpServers: ['./mcp/config.json', './server.mcpb', 'https://example.com/server.dxt', {
        local: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'], env: { TOKEN: '${user_config.token}' } },
        remote: { type: 'http', url: '${API_ENDPOINT}/mcp', headers: { Authorization: 'Bearer ${user_config.token}' }, oauth: { clientId: 'client', callbackPort: 8080, scopes: 'read' } },
      }],
      lspServers: ['./lsp.json', { typescript: { command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript' }, transport: 'stdio', requestTimeout: 1000, maxRestarts: 0, diagnostics: true, futureSetting: 1 } }],
      settings: { agent: 'reviewer', subagentStatusLine: { type: 'command', command: './status.sh' }, future: true },
      userConfig: { token: { type: 'string', title: 'Token', description: 'Service token', sensitive: true, future: 1 } },
      channels: [{ server: 'remote', displayName: 'Messages', userConfig: { room: { type: 'string', title: 'Room', description: 'Target room' } } }],
      experimental: { themes: './themes/', evals: ['quality/evals', './other-evals'], monitors: [{ name: 'review', command: 'watch-review', description: 'Review changes', when: 'on-skill-invoke:review' }], next: {} },
    };
    const before = structuredClone(manifest);
    expect(() => validateClaudePlugin(manifest)).not.toThrow();
    expect(manifest).toEqual(before);
  });

  it('accepts current legacy top-level theme/monitor fields and string command paths', () => {
    expect(() => validateClaudePlugin({ name: 'theme-kit', commands: ['./commands/', './review.md'], themes: './themes/', monitors: './monitors.json' })).not.toThrow();
  });

  it.each([
    null, [], {}, { name: '' }, { name: 'bad name' }, { name: '../outside' }, { name: 'plugin@marketplace' },
    { name: 'plugin\u202e' }, { name: 'plugin', author: 'Team' }, { name: 'plugin', author: {} },
    { name: 'plugin', homepage: 'not-a-url' }, { name: 'plugin', version: 1 },
    { name: 'plugin', keywords: [1] }, { name: 'plugin', defaultEnabled: 'true' },
    { name: 'plugin', dependencies: ['name@'] }, { name: 'plugin', dependencies: [{ version: '^1' }] },
  ])('rejects invalid metadata %#', manifest => {
    expect(() => validateClaudePlugin(manifest)).toThrowError(expect.objectContaining({ code: 'INVALID_CLAUDE_PLUGIN' }));
  });

  it.each([
    { agents: './agents/' }, { agents: './agent.json' }, { agents: 'agents/review.md' },
    { skills: '../outside' }, { skills: './nested/../../outside' }, { skills: '/absolute' },
    { skills: './folder\\outside' }, { skills: ['./valid/', null] },
    { hooks: './hooks.yaml' }, { lspServers: './server.yaml' }, { types: './state.ts' },
    { mcpServers: 'http://example.com/server.mcpb' }, { mcpServers: 'https://example.com/server.json' },
    { experimental: { evals: '../outside' } },
  ])('rejects invalid component paths %#', fields => {
    expect(() => validateClaudePlugin({ name: 'review-kit', ...fields })).toThrowError(expect.objectContaining({ code: 'INVALID_CLAUDE_PLUGIN' }));
  });

  it.each([
    { commands: { review: {} } }, { commands: { review: { source: './review.md', content: 'Review' } } },
    { commands: { review: { content: 123 } } }, { commands: { review: { source: './review.md', allowedTools: 'Read' } } },
    { hooks: { hooks: { Stop: [] } } }, { hooks: { Stop: [{ hooks: [{ type: 'command' }] }] } },
    { mcpServers: { local: {} } }, { mcpServers: { remote: { type: 'http' } } },
    { mcpServers: { remote: { type: 'unknown', url: 'https://example.com' } } },
    { mcpServers: { local: { command: 'node', args: '--stdio' } } },
    { mcpServers: { remote: { type: 'sse', url: 'https://example.com', headersHelper: 'echo ${user_config.token}' } } },
    { lspServers: { ts: { command: 'server', extensionToLanguage: {} } } },
    { lspServers: { ts: { command: 'server', extensionToLanguage: { ts: 'typescript' } } } },
    { lspServers: { ts: { command: 'server --stdio', extensionToLanguage: { '.ts': 'typescript' } } } },
    { lspServers: { ts: { command: 'server', extensionToLanguage: { '.ts': 'typescript' }, requestTimeout: 0 } } },
    { settings: { subagentStatusLine: { type: 'prompt', command: 'test' } } },
    { channels: [{ displayName: 'No server' }] },
    { experimental: { monitors: [{ name: 'a', description: 'Monitor', command: 'echo ${user_config.token}' }] } },
    { experimental: { monitors: [{ name: 'a', description: 'One', command: 'one' }, { name: 'a', description: 'Two', command: 'two' }] } },
  ])('rejects malformed known inline components %#', fields => {
    expect(() => validateClaudePlugin({ name: 'review-kit', ...fields })).toThrowError(expect.objectContaining({ code: 'INVALID_CLAUDE_PLUGIN' }));
  });

  it('validates configurable picker rules and keeps unrelated option extensions', () => {
    const option = { type: 'string', title: 'Tone', description: 'Writing tone', options: ['warm', 'neutral'], default: 'neutral', future: true };
    expect(() => validateClaudePlugin({ name: 'review-kit', userConfig: { tone: option } })).not.toThrow();
    expect(() => validateClaudePlugin({ name: 'review-kit', userConfig: { tone: { ...option, default: 'other' } } })).toThrow(/listed default/);
    expect(() => validateClaudePlugin({ name: 'review-kit', userConfig: { tone: { ...option, multiple: true } } })).toThrow(/single, non-sensitive/);
    expect(() => validateClaudePlugin({ name: 'review-kit', userConfig: { '1tone': option } })).toThrow(/identifiers/);
  });

  it('distinguishes plugin and project agent capabilities without implying execution', () => {
    expect(claudePluginCapabilities.ignoredPluginAgentFields).toContain('permissionMode');
    expect(claudePluginCapabilities.components.find(component => component.field === 'skills')?.loading).toBe('add');
    expect(claudePluginCapabilities.components.find(component => component.field === 'agents')?.loading).toBe('replace');
    expect(claudePluginCapabilities.validation).toContain('Referenced files');
  });
});
