import { describe, expect, it } from 'vitest';
import { semanticDiagnostics } from '../../src/plugins/agents/domain/semantics.ts';
import { externalAgentReference, isExternalReference } from '../../src/plugins/agents/domain/references.ts';

const agent = (extra: Record<string, unknown> = {}) => ({ model: 'anthropic/claude-sonnet-5', description: 'd', instruction: 'i', ...extra });
const codes = (config: Record<string, unknown>) => semanticDiagnostics(config, '16').map(entry => [entry.code, entry.pointer]);

describe('docker-agent semantic validation', () => {
  it('accepts version 16 or none and reports every other version without migrating', () => {
    expect(codes({ agents: { root: agent() } })).toEqual([]);
    expect(codes({ version: '16', agents: { root: agent() } })).toEqual([]);
    expect(semanticDiagnostics({ version: '2', agents: { root: agent() } }, '16')).toEqual([expect.objectContaining({ severity: 'error', code: 'unsupported-version', pointer: '/version' })]);
  });

  it('resolves sub-agent and handoff references locally or as external references without name clashes', () => {
    expect(codes({ agents: { root: agent({ sub_agents: ['helper', 'myorg/reviewer', 'https://example.com/agent.yaml'], handoffs: ['ghost'] }), helper: agent() } }))
      .toEqual([['unknown-agent-reference', '/agents/root/handoffs/0']]);
    expect(codes({ agents: { root: agent({ sub_agents: ['docker.io/acme/helper:v1'] }), helper: agent() } })).toEqual([['external-agent-conflict', '/agents/root/sub_agents/0']]);
    expect(externalAgentReference('reviewer:myorg/review-pr')).toEqual({ name: 'reviewer', ref: 'myorg/review-pr' });
    expect(externalAgentReference('docker.io/myorg/myagent:v1').name).toBe('myagent');
    expect(isExternalReference('team.yaml')).toBe(false);
    expect(isExternalReference('helper')).toBe(false);
  });

  it('rejects force_handoff to itself, to unknown agents and in cycles, reporting each cycle once', () => {
    expect(codes({ agents: { a: agent({ force_handoff: 'a' }) } })).toEqual([['force-handoff-self', '/agents/a/force_handoff']]);
    expect(codes({ agents: { a: agent({ force_handoff: 'nobody' }) } })).toEqual([['unknown-agent-reference', '/agents/a/force_handoff']]);
    expect(codes({ agents: { a: agent({ force_handoff: 'b' }), b: agent({ force_handoff: 'c' }), c: agent({ force_handoff: 'a' }), d: agent({ force_handoff: 'a' }) } }))
      .toEqual([['force-handoff-cycle', '/agents/a/force_handoff']]);
    expect(codes({ agents: { a: agent({ force_handoff: 'b' }), b: agent({ force_handoff: 'acme/finisher' }) } })).toEqual([]);
  });

  it('keeps instruction and instruction_file exclusive and instruction files local', () => {
    expect(codes({ agents: { root: agent({ instruction_file: 'prompt.md' }) } })).toEqual([['instruction-conflict', '/agents/root/instruction_file']]);
    const files = { model: 'auto', instruction_file: ['ok.md', '../escape.md', '/abs.md'] };
    expect(codes({ agents: { root: files } })).toEqual([['invalid-instruction-file', '/agents/root/instruction_file/1'], ['invalid-instruction-file', '/agents/root/instruction_file/2']]);
  });

  it('resolves named, inline provider/model, auto and alloy models like ensureModelsExist', () => {
    const models = { fast: { provider: 'anthropic', model: 'claude-haiku-4-5' }, team: { model: 'fast,openai/gpt-5-mini' }, loop: { model: 'loop,fast' } };
    expect(codes({ models, agents: { a: agent({ model: 'fast' }), b: agent({ model: 'auto' }), c: agent({ model: 'team' }), d: agent({ model: 'fast,google/gemini-3' }), e: agent({ model: 'loop' }) } })).toEqual([]);
    expect(codes({ models, agents: { a: agent({ model: 'missing' }), b: agent({ model: 'fast,unknown' }) } })).toEqual([['unknown-model', '/agents/a/model'], ['unknown-model', '/agents/b/model']]);
    expect(codes({ agents: { a: { harness: { type: 'claude-code' }, model: 'anything' } } })).toEqual([]);
    expect(codes({ models: { m: { provider: 'anthropic', model: 'x', routing: [{ model: 'nope', examples: ['e'] }] } }, agents: { a: agent({ model: 'm' }) } })).toEqual([['unknown-model', '/models/m/routing/0/model']]);
  });

  it('checks first_available selectors and provider definitions', () => {
    expect(codes({ models: { pick: { first_available: ['anthropic/claude-sonnet-5', ''], temperature: 0 } }, agents: { a: agent({ model: 'pick' }) } }))
      .toEqual([['invalid-model', '/models/pick/temperature'], ['invalid-model', '/models/pick/first_available/1']]);
    expect(codes({ providers: { local: { api_type: 'openai_chatcompletions' }, 'bad/name': { provider: 'anthropic' }, ok: { provider: 'anthropic' } }, agents: { a: agent() } }))
      .toEqual([['invalid-provider', '/providers/local/base_url'], ['invalid-provider', '/providers/bad~1name']]);
  });

  it('resolves toolset, MCP, RAG, command and skill definitions', () => {
    const config = {
      mcps: { github: { ref: 'docker:github-official' }, bad: { ref: 'npm:thing' } },
      agents: { root: agent({
        use_toolsets: ['shared', 'missing'], use_commands: ['nope'], use_skills: ['none'],
        toolsets: [{ type: 'mcp', ref: 'github' }, { type: 'mcp', ref: 'gitlab' }, { type: 'mcp', ref: 'docker:context7' }, { type: 'rag', ref: 'docs' }],
      }) },
      toolsets: { shared: { type: 'shell' } },
    };
    expect(codes(config)).toEqual([
      ['invalid-mcp-definition', '/mcps/bad/ref'],
      ['unknown-toolset', '/agents/root/use_toolsets/1'], ['unknown-command-group', '/agents/root/use_commands/0'], ['unknown-skill-group', '/agents/root/use_skills/0'],
      ['unknown-mcp-definition', '/agents/root/toolsets/1/ref'], ['unknown-rag-definition', '/agents/root/toolsets/3/ref'],
    ]);
  });

  it('applies the toolset rules the schema cannot express', () => {
    const toolsets = [
      { type: 'shell', path: 'x' }, { type: 'mcp' }, { type: 'mcp', command: 'npx', ref: 'docker:x' }, { type: 'lsp' }, { type: 'openapi' },
      { type: 'fetch', allowed_domains: ['*.ok.com', 'bad.*'], blocked_domains: ['10.0.0.0/33'] }, { type: 'mcp', remote: { url: 'https://x', oauth: { clientSecret: 's' } } },
      { type: 'filesystem', allow_list: [' '] }, { type: 'model_picker' }, { type: 'mcp', command: 'srv', working_dir: '.', allow_private_ips: true },
    ];
    expect(codes({ agents: { root: agent({ toolsets }) } })).toEqual([
      ['invalid-toolset', '/agents/root/toolsets/0/path'], ['invalid-toolset', '/agents/root/toolsets/1'], ['invalid-toolset', '/agents/root/toolsets/2'],
      ['invalid-toolset', '/agents/root/toolsets/3'], ['invalid-toolset', '/agents/root/toolsets/4'],
      ['invalid-toolset', '/agents/root/toolsets/5'], ['invalid-toolset', '/agents/root/toolsets/5/allowed_domains/1'], ['invalid-toolset', '/agents/root/toolsets/5/blocked_domains/0'],
      ['invalid-toolset', '/agents/root/toolsets/6/remote/oauth'], ['invalid-toolset', '/agents/root/toolsets/7/allow_list/0'], ['invalid-toolset', '/agents/root/toolsets/8'],
      ['invalid-toolset', '/agents/root/toolsets/9/allow_private_ips'],
    ]);
  });

  it('validates harness options and inline skills', () => {
    expect(codes({ agents: { a: { harness: { type: 'codex', effort: 'high' }, compaction_model: 'x' } } })).toEqual([['invalid-harness', '/agents/a/compaction_model'], ['invalid-harness', '/agents/a/harness/effort']]);
    const skills = ['local', 'https://example.com/skills', { name: 'has space', description: 'd', instructions: 'i' }, { name: 'x', description: 'd', instructions: 'i', toolsets: ['t'] }, { name: 'ok', description: 'd', instructions: 'i' }, { name: 'ok', description: 'd', instructions: 'i' }];
    expect(codes({ agents: { a: agent({ skills }) } })).toEqual([['unknown-toolset', '/agents/a/skills'], ['invalid-skills', '/agents/a/skills/2'], ['invalid-skills', '/agents/a/skills/3'], ['invalid-skills', '/agents/a/skills/5']]);
  });
});
