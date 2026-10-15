import { describe, expect, it } from 'vitest';
import { effectiveProvider, expandModelReference, externalAgentReference, firstAvailable, isExternalReference, modelResolves, parseModelReference } from '../../src/plugins/agents/domain/references.ts';

describe('agent references', () => {
  it.each<[string, { name: string; ref: string }]>([
    ['helper', { name: 'helper', ref: 'helper' }],
    ['agents/helper.yaml', { name: 'agents/helper.yaml', ref: 'agents/helper.yaml' }],
    ['http://example.com/agents/pirate.yaml', { name: 'pirate', ref: 'http://example.com/agents/pirate.yaml' }],
    ['https://example.com/a/pirate.yaml?v=1#top', { name: 'pirate', ref: 'https://example.com/a/pirate.yaml?v=1#top' }],
    ['https://example.com/a/pirate.tar.gz', { name: 'pirate.tar', ref: 'https://example.com/a/pirate.tar.gz' }],
    ['https://example.com/agent', { name: 'agent', ref: 'https://example.com/agent' }],
    ['https://example.com/.hidden', { name: '.hidden', ref: 'https://example.com/.hidden' }],
    ['https://example.com/', { name: '', ref: 'https://example.com/' }],
    ['docker.io/org/agent:1.2', { name: 'agent', ref: 'docker.io/org/agent:1.2' }],
    ['localhost:5000/org/agent', { name: 'agent', ref: 'localhost:5000/org/agent' }],
    [`org/agent@sha256:${'a'.repeat(64)}`, { name: 'agent', ref: `org/agent@sha256:${'a'.repeat(64)}` }],
    ['reviewer:docker.io/org/agent', { name: 'reviewer', ref: 'docker.io/org/agent' }],
    ['reviewer:https://example.com/a/pirate.yaml', { name: 'reviewer', ref: 'https://example.com/a/pirate.yaml' }],
    [':docker.io/org/agent', { name: ':docker.io/org/agent', ref: ':docker.io/org/agent' }],
    ['a/b:docker.io/org/agent', { name: 'a/b:docker.io/org/agent', ref: 'a/b:docker.io/org/agent' }],
    ['name:helper', { name: 'name:helper', ref: 'name:helper' }],
  ])('reads %s', (input, expected) => {
    expect(externalAgentReference(input)).toStrictEqual(expected);
  });

  it.each<[string, boolean]>([
    ['helper', false], ['agents/helper.yaml', false], ['org/Agent', false], ['http://h/a.yaml', true], ['reviewer:org/agent', true], ['org/agent', true],
  ])('tells whether %s is external', (input, external) => {
    expect(isExternalReference(input)).toBe(external);
  });

  it.each<[string, boolean]>([
    ['org/team/agent', true], ['Registry.Example-1.com/agent', true], ['localhost:5000/agent', true], ['registry.example.com:5000/org/agent:v1.2-rc', true],
    ['ns/host:port/agent', false], ['localhost:/agent', false], ['org//agent', false], ['org/agent/', false], ['/org/agent', false],
    ['org/my_agent', true], ['org/my.agent', true], ['org/my__agent', true], ['org/my---agent', true], ['org/my9agent2', true],
    ['my_org/agent', true], ['my_a--b/agent', true], ['org/team/my---agent', true], ['org/team/my_agent', true], ['org/team/my_', false],
    ['org/my___agent', false], ['org/my_.agent', false], ['org/agent_', false], ['org/_agent', false], ['org/team_/agent', false], ['org/my agent', false],
    ['org/agent:latest', true], ['org/agent:_tag', true], ['org/agent:', false], ['org/agent:-x', false], ['org/agent:.x', false], ['org/agent:a+b', false],
    [`org/agent:${'a'.repeat(128)}`, true], [`org/agent:${'a'.repeat(129)}`, false],
    [`org/agent@sha256:${'0123456789abcdef'.repeat(4)}`, true], [`org/agent:v1@sha256:${'a'.repeat(64)}`, true], [`org/agent@sha256:${'a'.repeat(63)}`, false],
    [`org/agent@sha256:${'a'.repeat(65)}`, false], [`org/agent@sha256:${'A'.repeat(64)}`, false], [`org/agent@sha256:${'g'.repeat(64)}`, false], [`org/agent@sha512:${'a'.repeat(64)}`, false],
    ['x!org/agent', false], ['org/agent!', false],
    ['org/agent.yaml', false], ['org/agent.yml', false], ['org/agent.YML', false], ['org/agent.hcl', false], ['org/agent.yamlx', true], ['org/agent.yaml.bak', true],
  ])('reads %s as an OCI reference: %s', (input, external) => {
    expect(isExternalReference(input)).toBe(external);
  });
});

describe('model references', () => {
  it.each<[string, { provider: string; model: string } | undefined]>([
    ['openai/gpt-5', { provider: 'openai', model: 'gpt-5' }],
    ['openrouter/meta/llama', { provider: 'openrouter', model: 'meta/llama' }],
    ['a/b', { provider: 'a', model: 'b' }],
    ['/gpt', undefined], ['openai/', undefined], ['gpt', undefined], ['', undefined],
  ])('parses %j', (ref, expected) => {
    expect(parseModelReference(ref)).toStrictEqual(expected);
  });

  it('expands alloys recursively and comma-separated references per part', () => {
    const config = { models: {
      team: { model: 'fast, openai/gpt-5' }, fast: { model: 'anthropic/haiku,  openai/mini' }, blank: { provider: '', model: 'a/x,b/y' },
      pinned: { provider: 'openai', model: 'a,b' }, single: { model: 'openai/gpt-5' }, loop: { model: 'loop,openai/gpt-5' },
    } };
    expect(expandModelReference(config, ' team ')).toStrictEqual(['anthropic/haiku', 'openai/mini', 'openai/gpt-5']);
    expect(expandModelReference(config, 'blank')).toStrictEqual(['a/x', 'b/y']);
    expect(expandModelReference(config, 'pinned')).toStrictEqual(['pinned']);
    expect(expandModelReference(config, 'single')).toStrictEqual(['single']);
    expect(expandModelReference(config, 'loop')).toStrictEqual(['loop', 'openai/gpt-5']);
    expect(expandModelReference(config, ' a, ,b ')).toStrictEqual(['a', 'b']);
    expect(expandModelReference(config, '   ')).toStrictEqual([]);
    expect(expandModelReference({}, 'openai/gpt-5')).toStrictEqual(['openai/gpt-5']);
  });

  it.each<[string, boolean]>([
    ['', true], ['  ', true], ['auto', true], [' auto ', true], ['named', true], [' named ', true], ['openai/gpt-5', true], ['missing', false], ['toString', false],
  ])('resolves %j: %s', (reference, resolves) => {
    expect(modelResolves({ models: { named: { provider: 'openai', model: 'gpt-5' } } }, reference)).toBe(resolves);
  });
});

describe('providers', () => {
  it.each<[unknown, string | undefined]>([
    [5, undefined], ['', undefined], [undefined, undefined], ['openai', 'openai'], ['corp', 'anthropic'], ['blank', 'blank'], ['numeric', 'numeric'], ['plain', 'plain'],
  ])('resolves provider %j to %j', (provider, expected) => {
    const config = { providers: { corp: { provider: 'anthropic' }, blank: { provider: '' }, numeric: { provider: 5 }, plain: 'x' } };
    expect(effectiveProvider(config, provider)).toBe(expected);
  });

  it('lists the first_available candidates of a selector model only', () => {
    expect(firstAvailable({ first_available: ['a/b', 5, 'c/d'] })).toStrictEqual(['a/b', 'c/d']);
    expect(firstAvailable({ model: 'a/b' })).toBeUndefined();
    expect(firstAvailable(['a/b'])).toBeUndefined();
  });
});
