import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { yamlDefinitions } from '../../src/plugins/agents/infrastructure/yaml-definitions.ts';
import { ajvDefinitionSchema } from '../../src/plugins/agents/infrastructure/schema.ts';
import { markdownFrontmatter } from '../../src/plugins/agents/infrastructure/frontmatter.ts';
import { mergeMcpServers, mergeSettings } from '../../src/plugins/agents/domain/claude-merge.ts';

const team = [
  '# Team header comment',
  'models:',
  '    claude: {provider: anthropic, model: claude-sonnet-5}  # inline flow map',
  '',
  'agents:',
  '    root:',
  '        model: claude',
  "        description: 'Leads'   # keep me",
  '        instruction: |',
  '            Lead the team.',
  '        toolsets:',
  '            - type: shell',
  '',
  '# trailing comment',
  'permissions:',
  '    allow: [shell]',
  '',
].join('\n');

describe('docker-agent YAML codec', () => {
  it('adds an agent after the last one and leaves every other byte, comment and style unchanged', () => {
    const edited = yamlDefinitions.addAgent(team, 'helper', { model: 'claude', description: 'Helps', instruction: 'Help.\nThen stop.\n', toolsets: [{ type: 'filesystem' }] });
    const at = team.indexOf('\n# trailing comment');
    expect(edited.startsWith(team.slice(0, at))).toBe(true);
    expect(edited.endsWith(team.slice(at))).toBe(true);
    // A blank line separates the new agent from the previous one, like the agents above it.
    expect(edited.slice(at, edited.length - team.length + at)).toBe([
      '',
      '    helper:', '        model: claude', '        description: Helps', '        instruction: |', '            Help.', '            Then stop.', '        toolsets:', '            - type: filesystem', '',
    ].join('\n'));
    expect(Object.keys(parse(edited).agents)).toEqual(['root', 'helper']);
  });

  it('rewrites flow-style agents maps through the Document API and keeps comments', () => {
    const edited = yamlDefinitions.addAgent('# keep\nagents: {root: {model: auto}}\n', 'b', { model: 'auto' });
    expect(edited).toContain('# keep');
    expect(parse(edited)).toEqual({ agents: { root: { model: 'auto' }, b: { model: 'auto' } } });
  });

  it('reports YAML errors with positions and locates JSON pointers', () => {
    const broken = yamlDefinitions.parse('agents:\n  root: [\n');
    expect(broken.value).toBeUndefined();
    expect(broken.diagnostics[0]).toMatchObject({ severity: 'error', code: 'yaml-syntax', line: expect.any(Number) });
    const parsed = yamlDefinitions.parse(team);
    expect(parsed.locate('/agents/root/toolsets/0/type')).toEqual({ line: 12, column: 21 });
    expect(parsed.locate('/agents/root/missing')).toEqual({ line: 7, column: 9 });
    expect(() => yamlDefinitions.addAgent('agents: [\n', 'x', {})).toThrow(expect.objectContaining({ code: 'INVALID_YAML' }));
  });

  it('renders new files with a header and the version', () => {
    const text = yamlDefinitions.render({ version: '16', agents: { a: { model: 'auto', instruction: 'One.\nTwo.\n' } } });
    expect(text).toMatch(/^# docker-agent configuration/);
    expect(text).toContain('version: "16"');
    expect(text).toContain('instruction: |\n      One.\n      Two.\n');
  });
});

describe('vendored JSON Schema', () => {
  it('reports unknown keys, wrong types and enums with JSON pointers', () => {
    const diagnostics = ajvDefinitionSchema.validate({ agents: { root: { model: 'auto', colour: 'red', toolsets: [{ type: 'teleport' }], max_iterations: 'many' } }, version: 7 });
    expect(diagnostics.map(entry => entry.pointer)).toEqual(expect.arrayContaining(['/agents/root/colour', '/agents/root/toolsets/0/type', '/agents/root/max_iterations', '/version']));
    expect(diagnostics.every(entry => entry.severity === 'error' && entry.code === 'schema')).toBe(true);
    expect(ajvDefinitionSchema.validate({})).toEqual([expect.objectContaining({ pointer: '', message: expect.stringContaining('agents') })]);
  });
});

describe('Claude file codecs and merges', () => {
  it('round-trips frontmatter without folding long lines and rejects files without it', () => {
    const metadata = { name: 'a', description: 'x '.repeat(80).trim(), 'x-forge-source': { path: 'agents/t.yaml', sha256: '0'.repeat(64), agent: 'a' } };
    const text = markdownFrontmatter.render(metadata, 'Body\n');
    expect(text.split('\n')[2]).toBe(`description: ${metadata.description}`);
    expect(markdownFrontmatter.parse(text)).toEqual({ metadata, body: 'Body\n' });
    expect(markdownFrontmatter.parse('---\r\nname: a\r\n---\r\nBody')).toEqual({ metadata: { name: 'a' }, body: 'Body' });
    expect(() => markdownFrontmatter.parse('No frontmatter')).toThrow(expect.objectContaining({ code: 'INVALID_CLAUDE_AGENT' }));
  });

  it('merges MCP servers and settings without clobbering unrelated keys', () => {
    const mcp = mergeMcpServers('.mcp.json', JSON.stringify({ mcpServers: { mine: { command: 'x' }, tools: { command: 'old' } }, other: true }), { tools: { type: 'stdio', command: 'new' } });
    expect(JSON.parse(mcp)).toEqual({ mcpServers: { mine: { command: 'x' }, tools: { type: 'stdio', command: 'new' } }, other: true });
    const settings = mergeSettings('.claude/settings.json', JSON.stringify({ model: 'opus', permissions: { allow: ['Read'], defaultMode: 'plan' } }), { permissions: { allow: ['Read', 'Bash(ls*)'], ask: [], deny: ['WebFetch'] }, agent: 'root' });
    expect(JSON.parse(settings)).toEqual({ model: 'opus', permissions: { allow: ['Read', 'Bash(ls*)'], defaultMode: 'plan', deny: ['WebFetch'] }, agent: 'root' });
    expect(JSON.parse(mergeSettings('s', undefined, { permissions: { allow: [], ask: [], deny: [] } }))).toEqual({});
    expect(() => mergeMcpServers('.mcp.json', '{', {})).toThrow(expect.objectContaining({ code: 'INVALID_CLAUDE_SETTINGS' }));
    expect(() => mergeSettings('s', '{"permissions": {"allow": "Read"}}', { permissions: { allow: ['x'], ask: [], deny: [] } })).toThrow(expect.objectContaining({ code: 'INVALID_CLAUDE_SETTINGS' }));
  });
});
