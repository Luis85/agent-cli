import { describe, expect, it } from 'vitest';
import { semanticDiagnostics } from '../../src/plugins/agents/domain/semantics.ts';

const agent = (extra: Record<string, unknown> = {}) => ({ model: 'anthropic/claude-sonnet-5', description: 'd', instruction: 'i', ...extra });
/** Every diagnostic as `[code, pointer, message]`; each one is an error. */
function report(config: Record<string, unknown>): string[][] {
  const diagnostics = semanticDiagnostics(config, '16');
  expect(diagnostics.every(entry => entry.severity === 'error')).toBe(true);
  return diagnostics.map(entry => [entry.code, entry.pointer, entry.message]);
}

describe('semantic diagnostic messages', () => {
  it('names a missing agent list and an unsupported version with the version Forge reads', () => {
    expect(report({})).toEqual([['no-agents', '/agents', "At least one agent must be configured (add an entry under 'agents')."]]);
    expect(report({ version: 2, agents: { root: agent() } })).toEqual([['unsupported-version', '/version',
      'Forge reads docker-agent configuration version 16; version 2 is not migrated. Update the file to version 16 syntax (docker-agent migrates older files when it loads them) or remove the version key.']]);
  });

  it.each([
    ['', { provider: 'anthropic' }, [['invalid-provider', '/providers/', "provider '': name cannot be empty"]]],
    ['  ', { provider: 'anthropic' }, [['invalid-provider', '/providers/  ', "provider '  ': name cannot be empty"]]],
    [' local', { provider: 'anthropic' }, [['invalid-provider', '/providers/ local', "provider ' local': name cannot have leading or trailing whitespace"]]],
    ['a/b', { provider: 'anthropic' }, [['invalid-provider', '/providers/a~1b', "provider 'a/b': name cannot contain '/'"]]],
    ['p', { api_type: 'grpc', base_url: 'https://x' }, [['invalid-provider', '/providers/p/api_type', "provider 'p': invalid api_type 'grpc' (must be one of: openai_chatcompletions, openai_responses)"]]],
    ['p', { provider: 'openai' }, [['invalid-provider', '/providers/p/base_url', "provider 'p': base_url is required for OpenAI-compatible providers"]]],
    ['p', { provider: '' }, [['invalid-provider', '/providers/p/base_url', "provider 'p': base_url is required for OpenAI-compatible providers"]]],
    ['p', { provider: 'anthropic', api_type: 'openai_responses' }, [['invalid-provider', '/providers/p/base_url', "provider 'p': base_url is required for OpenAI-compatible providers"]]],
    ['p', { api_type: 'openai_chatcompletions', base_url: 'https://proxy' }, []],
    ['p', { api_type: 'openai_responses', base_url: 'https://proxy' }, []],
    ['p', { provider: 'anthropic' }, []],
    ['p', { provider: 'google', base_url: '' }, []],
    ['p', {}, [['invalid-provider', '/providers/p/base_url', "provider 'p': base_url is required for OpenAI-compatible providers"]]],
  ])('checks the provider %j %j', (name, provider, expected) => {
    expect(report({ providers: { [name]: provider }, agents: { root: agent() } })).toEqual(expected);
  });

  it('accepts only docker MCP definitions and ignores empty or missing refs', () => {
    expect(report({ mcps: { a: { ref: 'npm:thing' }, b: { ref: 'docker:context7' }, c: { ref: '' }, d: { ref: 7 }, e: {} }, agents: { root: agent() } }))
      .toEqual([['invalid-mcp-definition', '/mcps/a/ref', "MCP definition 'a': only docker refs are supported (e.g., 'docker:context7')."]]);
  });

  it('resolves models named by routing rules and RAG strategies', () => {
    const config = {
      models: { m: { provider: 'anthropic', model: 'x', routing: [{ model: 'fast' }, { model: 'nope' }, { model: 3 }] }, fast: { provider: 'anthropic', model: 'y' }, plain: { provider: 'anthropic', model: 'z', routing: 'none' } },
      rag: { docs: { strategies: [{ type: 'chunked-embeddings', model: 'gone' }, { type: 'bm25' }, { type: 'semantic', model: 'fast' }] }, flat: { strategies: 'none' } },
      agents: { root: agent() },
    };
    expect(report(config)).toEqual([
      ['unknown-model', '/models/m/routing/1/model', "routing rule 1 in model 'm' references non-existent model 'nope'."],
      ['unknown-model', '/rag/docs/strategies/0/model', "RAG strategy 'chunked-embeddings' in RAG 'docs' references non-existent model 'gone'."],
    ]);
  });

  it.each([
    ['', 'has an empty skills entry.'],
    ['   ', 'has an empty skills entry.'],
    ['https://', "has invalid skills source URL 'https://'."],
    ['http://', "has invalid skills source URL 'http://'."],
    ['https://exa mple.com', "has invalid skills source URL 'https://exa mple.com'."],
    ['http://exa mple.com', "has invalid skills source URL 'http://exa mple.com'."],
    [{ description: 'd', instructions: 'i' }, 'has an inline skill with no name.'],
    [{ name: ' ', description: 'd', instructions: 'i' }, 'has an inline skill with no name.'],
    [{ name: 'a\tb', description: 'd', instructions: 'i' }, "inline skill 'a\tb' must not have whitespace in its name: it doubles as the /a\tb command."],
    [{ name: 'x', instructions: 'i' }, "inline skill 'x' is missing a description."],
    [{ name: 'x', description: 'd' }, "inline skill 'x' is missing instructions."],
    [{ name: 'x', description: 'd', instructions: 'i', context: 'spawn' }, "inline skill 'x' has invalid context 'spawn' (only 'fork' is supported)."],
    [{ name: 'x', description: 'd', instructions: 'i', toolsets: ['t'] }, "inline skill 'x' declares toolsets but is not a fork skill (set context: fork)."],
    [{ name: 'x', description: 'd', instructions: 'i', allowed_tools: ['read'] }, "inline skill 'x' declares allowed_tools but is not a fork skill (set context: fork)."],
  ])('reports the skill group entry %j', (entry, message) => {
    expect(report({ skills: { group: ['local', entry] }, agents: { root: agent() } })).toEqual([['invalid-skills', '/skills/group/1', `skill group 'group' ${message}`]]);
  });

  it('accepts local, URL and fork skills, and reports a duplicate inline skill once per repeat', () => {
    const fork = { name: 'f', description: 'd', instructions: 'i', context: 'fork', toolsets: ['t'], allowed_tools: ['read'] };
    const ok = { name: 'ok', description: 'd', instructions: 'i' };
    expect(report({ skills: { group: ['local', 'https://example.com/skills', 'skills/local', fork, ok, ok, ok] }, toolsets: { t: { type: 'shell' } }, agents: { root: agent() } })).toEqual([
      ['invalid-skills', '/skills/group/5', "skill group 'group' has duplicate inline skill 'ok'."],
      ['invalid-skills', '/skills/group/6', "skill group 'group' has duplicate inline skill 'ok'."],
    ]);
    expect(report({ skills: { group: 'local' }, agents: { root: agent({ skills: 'local' }) } })).toEqual([]);
  });

  it('names the kind of each unresolved agent reference and external name clash', () => {
    expect(report({ agents: { root: agent({ sub_agents: ['ghost', 'docker.io/acme/helper:v1'], handoffs: ['nobody', 'acme/helper'] }), helper: agent() } })).toEqual([
      ['unknown-agent-reference', '/agents/root/sub_agents/0', "agent 'root' references non-existent sub-agent 'ghost'."],
      ['external-agent-conflict', '/agents/root/sub_agents/1', "agent 'root': external sub-agent 'docker.io/acme/helper:v1' resolves to name 'helper' which conflicts with a locally-defined agent."],
      ['unknown-agent-reference', '/agents/root/handoffs/0', "agent 'root' references non-existent handoff agent 'nobody'."],
      ['external-agent-conflict', '/agents/root/handoffs/1', "agent 'root': external handoff agent 'acme/helper' resolves to name 'helper' which conflicts with a locally-defined agent."],
    ]);
  });

  it('names each unresolved definition an agent uses', () => {
    const config = {
      toolsets: { shared: { type: 'shell' } }, commands: { ops: {} }, skills: { kit: [{ name: 'k', description: 'd', instructions: 'i', context: 'fork', toolsets: ['shared', 'gone'] }] },
      mcps: { github: { ref: 'docker:github-official' } }, rag: { docs: {} },
      agents: { root: agent({
        use_toolsets: ['shared', 'missing'], use_commands: ['ops', 'nope'], use_skills: ['kit', 'none'],
        toolsets: [{ type: 'mcp', ref: 'github' }, { type: 'mcp', ref: 'gitlab' }, { type: 'rag', ref: 'docs' }, { type: 'rag', ref: 'wiki' }, { type: 'mcp', ref: '' }, { type: 'rag', ref: 4 }],
      }) },
    };
    // The toolset rules report the empty and non-text refs themselves; the definition check skips them.
    expect(report(config).filter(([code]) => code !== 'invalid-toolset')).toEqual([
      ['unknown-toolset', '/agents/root/use_toolsets/1', "agent 'root' references non-existent toolset 'missing'."],
      ['unknown-command-group', '/agents/root/use_commands/1', "agent 'root' references non-existent command group 'nope'."],
      ['unknown-skill-group', '/agents/root/use_skills/1', "agent 'root' references non-existent skill group 'none'."],
      ['unknown-mcp-definition', '/agents/root/toolsets/1/ref', "agent 'root' references non-existent MCP definition 'gitlab'."],
      ['unknown-rag-definition', '/agents/root/toolsets/3/ref', "agent 'root' references non-existent RAG definition 'wiki'."],
      ['unknown-toolset', '/agents/root/skills', "agent 'root' inline skill 'k' references non-existent toolset 'gone'."],
    ]);
  });

  it('reports instruction conflicts, non-local instruction files, unknown budgets and models', () => {
    expect(report({ budgets: { daily: {} }, agents: { a: agent({ instruction_file: '../up.md', budgets: ['daily', 'weekly'], model: 'fast' }) } })).toEqual([
      ['instruction-conflict', '/agents/a/instruction_file', "agent 'a': 'instruction' and 'instruction_file' are mutually exclusive, set only one."],
      ['invalid-instruction-file', '/agents/a/instruction_file', 'instruction_file "../up.md" must be a relative path to a file in the definition file\'s folder or below it.'],
      ['unknown-budget', '/agents/a/budgets', 'agents.a: budgets: unknown budget "weekly"; define it under the top-level \'budgets\'.'],
      ['unknown-model', '/agents/a/model', "agent 'a' references non-existent model 'fast'."],
    ]);
    expect(report({ agents: { a: agent({ instruction: '', instruction_file: 'prompt.md' }), b: { model: 'auto', instruction_file: 'prompt.md' } } })).toEqual([]);
    expect(report({ agents: { a: { model: 7 } } })).toEqual([]);
  });

  it('names force_handoff problems and each cycle with its members', () => {
    expect(report({ agents: { a: agent({ force_handoff: 'a' }), b: agent({ force_handoff: 'nobody' }), c: agent({ force_handoff: 'docker.io/acme/a:v1' }), d: agent({ force_handoff: '' }), e: agent({ force_handoff: 3 }) } })).toEqual([
      ['force-handoff-self', '/agents/a/force_handoff', "agent 'a' cannot force_handoff to itself."],
      ['unknown-agent-reference', '/agents/b/force_handoff', "agent 'b' references non-existent force_handoff agent 'nobody'."],
      ['external-agent-conflict', '/agents/c/force_handoff', "agent 'c': external force_handoff 'docker.io/acme/a:v1' resolves to name 'a' which conflicts with a locally-defined agent."],
    ]);
    expect(report({ agents: { a: agent({ force_handoff: 'b' }), b: agent({ force_handoff: 'a' }), x: agent({ force_handoff: 'y' }), y: agent({ force_handoff: 'z' }), z: agent({ force_handoff: 'x' }), tail: agent({ force_handoff: 'x' }) } })).toEqual([
      ['force-handoff-cycle', '/agents/a/force_handoff', "force_handoff cycle detected involving agents 'a', 'b'."],
      ['force-handoff-cycle', '/agents/x/force_handoff', "force_handoff cycle detected involving agents 'x', 'y', 'z'."],
    ]);
    expect(report({ agents: { tail: agent({ force_handoff: 'x' }), x: agent({ force_handoff: 'y' }), y: agent({ force_handoff: 'x' }) } })).toEqual([
      ['force-handoff-cycle', '/agents/x/force_handoff', "force_handoff cycle detected involving agents 'x', 'y'."],
    ]);
  });

  it('names agent-level skill problems after the agent and points top-level toolset problems at the toolset', () => {
    expect(report({ agents: { a: agent({ skills: [''] }) } })).toEqual([['invalid-skills', '/agents/a/skills/0', "agent 'a' has an empty skills entry."]]);
    expect(report({ toolsets: { bad: { type: 'lsp' } }, agents: { a: agent() } }).map(([code, pointer]) => [code, pointer])).toEqual([['invalid-toolset', '/toolsets/bad']]);
  });

  it('orders diagnostics by section: version, agents, providers, models, MCPs, skills, references, agents, then handoffs', () => {
    const config = {
      version: '1', providers: { 'a/b': {} }, mcps: { m: { ref: 'npm:x' } }, skills: { g: [''] },
      models: { r: { provider: 'anthropic', model: 'x', routing: [{ model: 'nope' }] } },
      agents: { a: agent({ model: 'gone', force_handoff: 'a' }) },
    };
    expect(report(config).map(([code]) => code)).toEqual(['unsupported-version', 'invalid-provider', 'invalid-mcp-definition', 'invalid-skills', 'unknown-model', 'unknown-model', 'force-handoff-self']);
  });
});
