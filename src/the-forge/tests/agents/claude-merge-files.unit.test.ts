import { describe, expect, it } from 'vitest';
import { foreignEntries, mergeMcpServers, mergeSettings, nextManifest, parseManifest, type ForgeManifest, type GeneratedSettings } from '../../src/plugins/agents/domain/claude-merge.ts';

const none = (): GeneratedSettings => ({ permissions: { allow: [], ask: [], deny: [] } });
const manifest = (extra: Partial<ForgeManifest> = {}): ForgeManifest => ({ mcpServers: {}, settings: {}, ...extra });
const invalid = (message: string) => expect.objectContaining({ code: 'INVALID_CLAUDE_SETTINGS', message });
const conflict = (message: string, details: Record<string, unknown>) => expect.objectContaining({ code: 'AGENT_MERGE_CONFLICT', message, details });
const notJson = (path: string) => `${path} is not valid JSON; fix it before generating into it.`;

describe('existing Claude files Forge cannot merge into', () => {
  it.each<[string, () => unknown, string]>([
    ['unparseable .mcp.json', () => mergeMcpServers('{', {}, manifest()), notJson('.mcp.json')],
    ['.mcp.json holding an array', () => mergeMcpServers('[]', {}, manifest()), '.mcp.json must contain a JSON object.'],
    ['.mcp.json holding null', () => mergeMcpServers('null', {}, manifest()), '.mcp.json must contain a JSON object.'],
    ['.mcp.json mcpServers as a list', () => mergeMcpServers('{"mcpServers": []}', {}, manifest()), '.mcp.json mcpServers must be an object.'],
    ['unparseable settings', () => mergeSettings('nope', none(), manifest()), notJson('.claude/settings.json')],
    ['settings permissions as a number', () => mergeSettings('{"permissions": 5}', none(), manifest()), '.claude/settings.json permissions must be an object.'],
    ['settings ask as a string', () => mergeSettings('{"permissions": {"ask": "Bash"}}', none(), manifest()), '.claude/settings.json permissions.ask must be an array of strings.'],
    ['settings deny mixing strings and numbers', () => mergeSettings('{"permissions": {"deny": ["Bash", 5]}}', none(), manifest()), '.claude/settings.json permissions.deny must be an array of strings.'],
    ['unparseable manifest', () => parseManifest('{"settings":'), notJson('.claude/forge-generated.json')],
    ['manifest holding a number', () => parseManifest('5'), '.claude/forge-generated.json must contain a JSON object.'],
    ['manifest settings as a list', () => parseManifest('{"settings": []}'), '.claude/forge-generated.json settings must be an object.'],
    ['manifest mcpServers as text', () => parseManifest('{"mcpServers": "x"}'), '.claude/forge-generated.json mcpServers must be an object.'],
    ['manifest permissions as a number', () => parseManifest('{"settings": {"permissions": 5}}'), '.claude/forge-generated.json settings permissions must be an object.'],
    ['foreign entries of an unparseable .mcp.json', () => foreignEntries('{', undefined, manifest()), notJson('.mcp.json')],
    ['foreign entries of a scalar mcpServers', () => foreignEntries('{"mcpServers": 1}', undefined, manifest()), '.mcp.json mcpServers must be an object.'],
    ['foreign entries of unparseable settings', () => foreignEntries(undefined, '{', manifest()), notJson('.claude/settings.json')],
    ['next manifest over a list of mcpServers', () => nextManifest(manifest(), undefined, { mcp: '{"mcpServers": []}' }, { servers: {} }), '.mcp.json mcpServers must be an object.'],
    ['next manifest over unparseable .mcp.json', () => nextManifest(manifest(), undefined, { mcp: '{' }, { servers: {} }), notJson('.mcp.json')],
    ['next manifest over unparseable settings', () => nextManifest(manifest(), undefined, { settings: '{' }, { servers: {} }), notJson('.claude/settings.json')],
    ['next manifest over scalar settings permissions', () => nextManifest(manifest(), undefined, { settings: '{"permissions": 5}' }, { servers: {} }), '.claude/settings.json permissions must be an object.'],
    ['next manifest over a string allow list', () => nextManifest(manifest(), undefined, { settings: '{"permissions": {"allow": "x"}}' }, { servers: {} }), '.claude/settings.json permissions.allow must be an array of strings.'],
  ])('rejects %s, naming the file and the key', (_name, call, message) => {
    expect(call).toThrowError(invalid(message));
  });
});

describe('file style', () => {
  it.each<[string, string | undefined, string]>([
    ['a new file with two spaces and a final newline', undefined, '{\n  "mcpServers": {\n    "a": {\n      "command": "x"\n    }\n  }\n}\n'],
    ['a one-line file with the default indent and no final newline', '{"mcpServers": {}}', '{\n  "mcpServers": {\n    "a": {\n      "command": "x"\n    }\n  }\n}'],
    ['a four-space LF file with its final newline', '{\n    "mcpServers": {}\n}\n', '{\n    "mcpServers": {\n        "a": {\n            "command": "x"\n        }\n    }\n}\n'],
    ['a tab-indented file aligned with spaces', '{\n\t  "mcpServers": {}\n}', '{\n\t"mcpServers": {\n\t\t"a": {\n\t\t\t"command": "x"\n\t\t}\n\t}\n}'],
    ['a tab-indented CRLF file', '{\r\n\t"mcpServers": {}\r\n}\r\n', '{\r\n\t"mcpServers": {\r\n\t\t"a": {\r\n\t\t\t"command": "x"\r\n\t\t}\r\n\t}\r\n}\r\n'],
  ])('writes %s', (_name, text, expected) => {
    expect(mergeMcpServers(text, { a: { command: 'x' } }, manifest())).toBe(expected);
  });
});

describe('MCP servers in .mcp.json', () => {
  it('refuses to replace servers Forge did not write, naming each one', () => {
    const text = JSON.stringify({ mcpServers: { a: { command: 'user-a' }, b: { command: 'user-b' }, c: { command: 'c' } } });
    expect(() => mergeMcpServers(text, { a: { command: 'a' }, b: { command: 'b' }, c: { command: 'c' } }, manifest())).toThrowError(conflict(
      '.mcp.json already defines a, b, which Forge did not generate; rename the MCP toolsets or pass --rename-conflicts.', { path: '.mcp.json', servers: ['a', 'b'] },
    ));
  });

  it('accepts an identical server, replaces an owned unchanged one, regenerates a deleted one and keeps the rest in order', () => {
    const text = JSON.stringify({ other: true, mcpServers: { user: { command: 'u' }, same: { command: 's' }, owned: { command: 'old' } } });
    const owned = manifest({ mcpServers: { owned: { command: 'old' }, deleted: { command: 'gone' } } });
    const merged = mergeMcpServers(text, { same: { command: 's' }, owned: { command: 'new' }, deleted: { command: 'back' } }, owned);
    expect(JSON.parse(merged)).toStrictEqual({ other: true, mcpServers: { user: { command: 'u' }, same: { command: 's' }, owned: { command: 'new' }, deleted: { command: 'back' } } });
    expect(Object.keys(JSON.parse(merged).mcpServers)).toStrictEqual(['user', 'same', 'owned', 'deleted']);
  });
});

describe('entries Forge did not write', () => {
  it('lists servers that are not recorded or changed since Forge wrote them', () => {
    const mcp = JSON.stringify({ mcpServers: { kept: { command: 'k' }, user: { command: 'u' }, edited: { command: 'mine' } } });
    const recorded = manifest({ mcpServers: { kept: { command: 'k' }, edited: { command: 'forge' } } });
    expect(foreignEntries(mcp, undefined, recorded)).toStrictEqual({ servers: { user: { command: 'u' }, edited: { command: 'mine' } } });
    expect(foreignEntries(undefined, undefined, recorded)).toStrictEqual({ servers: {} });
  });

  it.each<[string, string | undefined, string | undefined, Record<string, unknown>]>([
    ['no agent in the file although one is recorded', '{}', 'lead', { servers: {} }],
    ['the recorded agent', '{"agent": "lead"}', 'lead', { servers: {} }],
    ['another agent', '{"agent": "mine"}', 'lead', { servers: {}, agent: 'mine' }],
    ['an agent with nothing recorded', '{"agent": "mine"}', undefined, { servers: {}, agent: 'mine' }],
    ['a non-string agent, as its JSON text', '{"agent": {"name": "x"}}', 'lead', { servers: {}, agent: '{"name":"x"}' }],
  ])('reports the settings agent for %s', (_name, settings, recordedAgent, expected) => {
    expect(foreignEntries(undefined, settings, manifest({ settings: recordedAgent === undefined ? {} : { agent: recordedAgent } }))).toStrictEqual(expected);
  });
});

describe('the main agent in .claude/settings.json', () => {
  it('refuses to replace an agent Forge did not set', () => {
    expect(() => mergeSettings('{"agent": "mine"}', { ...none(), agent: 'lead' }, manifest({ settings: { agent: 'old' } }))).toThrowError(conflict(
      '.claude/settings.json already sets agent to "mine", which Forge did not generate; remove it to let Forge set lead.', { path: '.claude/settings.json', agent: 'mine' },
    ));
  });

  it.each<[string, string, string | undefined, string | undefined, unknown]>([
    ['keeps the user agent when no agent is generated', '{"agent": "mine"}', undefined, 'lead', 'mine'],
    ['sets the agent where the file has none', '{}', 'lead', 'old', 'lead'],
    ['keeps an agent the file already holds', '{"agent": "lead"}', 'lead', 'other', 'lead'],
    ['replaces the agent Forge set before', '{"agent": "old"}', 'new', 'old', 'new'],
  ])('%s', (_name, text, agent, recorded, expected) => {
    const generated = agent === undefined ? none() : { ...none(), agent };
    const merged = mergeSettings(text, generated, manifest({ settings: recorded === undefined ? {} : { agent: recorded } }));
    expect(JSON.parse(merged.text)).toStrictEqual({ agent: expected });
    expect(merged).toMatchObject({ owned: {}, revoked: [] });
  });

  it('keeps a permissions object that was already empty or held only other settings', () => {
    expect(JSON.parse(mergeSettings('{"permissions": {}}', none(), manifest()).text)).toStrictEqual({ permissions: {} });
    expect(JSON.parse(mergeSettings('{"permissions": {"defaultMode": "plan"}}', none(), manifest()).text)).toStrictEqual({ permissions: { defaultMode: 'plan' } });
    expect(JSON.parse(mergeSettings(undefined, none(), manifest()).text)).toStrictEqual({});
  });
});

describe('the manifest', () => {
  it('reads an absent or empty manifest as owning nothing', () => {
    expect(parseManifest(undefined)).toStrictEqual({ mcpServers: {}, settings: {} });
    expect(parseManifest('{}')).toStrictEqual({ mcpServers: {}, settings: {} });
    expect(parseManifest('{"settings": {"agent": 5, "permissions": {}}}')).toStrictEqual({ mcpServers: {}, settings: {} });
    expect(parseManifest('{"mcpServers": {"a": {"command": "x"}}, "settings": {"agent": "lead"}}')).toStrictEqual({ mcpServers: { a: { command: 'x' } }, settings: { agent: 'lead' } });
  });

  it('describes itself and records the servers still unchanged plus the ones written now', () => {
    const previous = manifest({ mcpServers: { kept: { command: 'k' }, edited: { command: 'forge' }, gone: { command: 'g' } } });
    const mcp = JSON.stringify({ mcpServers: { kept: { command: 'k' }, edited: { command: 'mine' } } });
    const text = nextManifest(previous, undefined, { mcp }, { servers: { fresh: { command: 'f' } } });
    expect(JSON.parse(text)).toStrictEqual({
      description: 'Entries The Forge wrote with agents generate. Forge replaces an entry of .mcp.json or .claude/settings.json only while it still has the content recorded here, and removes a recorded permission rule once none of the definitions in its origins grants it.',
      mcpServers: { kept: { command: 'k' }, fresh: { command: 'f' } },
      settings: {},
    });
    expect(text.endsWith('}\n')).toBe(true);
  });

  it.each<[string, string | undefined, string | undefined, string | undefined, Record<string, unknown>]>([
    ['records the agent written now', 'new', 'old', '{"agent": "old"}', { agent: 'new' }],
    ['keeps the recorded agent while the file holds it', undefined, 'old', '{"agent": "old"}', { agent: 'old' }],
    ['forgets the recorded agent once the user changed it', undefined, 'old', '{"agent": "mine"}', {}],
    ['records no agent when there is none', undefined, undefined, '{"agent": "mine"}', {}],
  ])('%s', (_name, written, recorded, settings, expected) => {
    const previous = manifest({ settings: recorded === undefined ? {} : { agent: recorded } });
    const text = nextManifest(previous, undefined, { settings }, { servers: {}, ...(written === undefined ? {} : { agent: written }) });
    expect(JSON.parse(text).settings).toStrictEqual(expected);
  });

  it('without a settings merge, keeps only the recorded rules the file still holds', () => {
    const origin = { file: 'agents/team.yaml' };
    const previous = manifest({ settings: { permissions: { allow: [{ rule: 'Read', origins: [origin] }, { rule: 'Glob', origins: [origin] }], deny: [{ rule: 'Bash(rm *)', origins: [origin] }] } } });
    const text = nextManifest(previous, undefined, { settings: '{"permissions": {"allow": ["Glob", "Grep"]}}' }, { servers: {} });
    expect(JSON.parse(text).settings).toStrictEqual({ permissions: { allow: [{ rule: 'Glob', origins: [origin] }] } });
    expect(JSON.parse(nextManifest(previous, undefined, {}, { servers: {} })).settings).toStrictEqual({});
  });
});
