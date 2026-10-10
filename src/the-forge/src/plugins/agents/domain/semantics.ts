import {
  agentEntries, diagnostic, instructionFiles, isObject, pointer, record, stringList, supportedConfigVersion, text,
  type AgentConfigDocument, type AgentDiagnostic,
} from './config.ts';
import { expandModelReference, externalAgentReference, isExternalReference, modelResolves } from './references.ts';
import { harnessDiagnostics, modelDiagnostics, toolsetDiagnostics } from './toolset-rules.ts';

/**
 * docker-agent's semantic checks after decoding (`validateConfig`, `ensureModelsExist`, `resolveInstructionFiles`
 * and the definition resolvers in `pkg/config` at the vendored commit), reported as diagnostics instead of the first
 * failure. Forge reads configuration version 16 only: other versions get a diagnostic and are never migrated.
 */
export function semanticDiagnostics(config: AgentConfigDocument): AgentDiagnostic[] {
  const agents = agentEntries(config);
  return [
    ...versionDiagnostics(config),
    ...(agents.length === 0 ? [diagnostic('error', 'no-agents', '/agents', "At least one agent must be configured (add an entry under 'agents').")] : []),
    ...providerDiagnostics(config),
    ...Object.entries(record(config.models)).flatMap(([name, model]) => modelDiagnostics(model, pointer('models', name))),
    ...Object.entries(record(config.toolsets)).flatMap(([name, toolset]) => toolsetDiagnostics(toolset, pointer('toolsets', name))),
    ...Object.entries(record(config.mcps)).flatMap(([name, definition]) => {
      const ref = record(definition).ref;
      return typeof ref === 'string' && ref !== '' && !ref.startsWith('docker:')
        ? [diagnostic('error', 'invalid-mcp-definition', pointer('mcps', name, 'ref'), `MCP definition '${name}': only docker refs are supported (e.g., 'docker:context7').`)] : [];
    }),
    ...Object.entries(record(config.skills)).flatMap(([name, group]) => skillsDiagnostics(group, pointer('skills', name), `skill group '${name}'`)),
    ...modelReferenceDiagnostics(config),
    ...agents.flatMap(([name, agent]) => agentDiagnostics(config, name, agent)),
    ...forceHandoffDiagnostics(config),
  ];
}

function versionDiagnostics(config: AgentConfigDocument): AgentDiagnostic[] {
  if (config.version === undefined || config.version === supportedConfigVersion) return [];
  return [diagnostic('error', 'unsupported-version', '/version', `Forge reads docker-agent configuration version ${supportedConfigVersion}; version ${JSON.stringify(config.version)} is not migrated. Update the file to version ${supportedConfigVersion} syntax (docker-agent migrates older files when it loads them) or remove the version key.`)];
}

function providerDiagnostics(config: AgentConfigDocument): AgentDiagnostic[] {
  return Object.entries(record(config.providers)).flatMap(([name, value]) => {
    const provider = record(value), at = pointer('providers', name);
    const fail = (message: string, field = '') => [diagnostic('error', 'invalid-provider', `${at}${field}`, `provider '${name}': ${message}`)];
    if (name.trim() === '') return fail('name cannot be empty');
    if (name.trim() !== name) return fail('name cannot have leading or trailing whitespace');
    if (name.includes('/')) return fail("name cannot contain '/'");
    const apiType = provider.api_type ?? '';
    if (!['', 'openai_chatcompletions', 'openai_responses'].includes(String(apiType))) return fail(`invalid api_type '${String(apiType)}' (must be one of: openai_chatcompletions, openai_responses)`, '/api_type');
    const openAiCompatible = apiType !== '' || provider.provider === undefined || provider.provider === '' || provider.provider === 'openai';
    if (!text(provider.base_url) && openAiCompatible) return fail('base_url is required for OpenAI-compatible providers', '/base_url');
    return [];
  });
}

/** Models referenced by routing rules and RAG strategies must resolve like agent models. */
function modelReferenceDiagnostics(config: AgentConfigDocument): AgentDiagnostic[] {
  const unknown = (reference: unknown, at: string, owner: string) => typeof reference === 'string' && !modelResolves(config, reference)
    ? [diagnostic('error', 'unknown-model', at, `${owner} references non-existent model '${reference}'.`)] : [];
  return [
    ...Object.entries(record(config.models)).flatMap(([name, model]) => (Array.isArray(record(model).routing) ? record(model).routing as unknown[] : [])
      .flatMap((rule, index) => unknown(record(rule).model, pointer('models', name, 'routing', index, 'model'), `routing rule ${index} in model '${name}'`))),
    ...Object.entries(record(config.rag)).flatMap(([name, rag]) => (Array.isArray(record(rag).strategies) ? record(rag).strategies as unknown[] : [])
      .flatMap((strategy, index) => unknown(record(strategy).model, pointer('rag', name, 'strategies', index, 'model'), `RAG strategy '${String(record(strategy).type)}' in RAG '${name}'`))),
  ];
}

const sourceUrl = (source: string) => source.startsWith('http://') || source.startsWith('https://');

/** docker-agent's `validateSkills` for an agent's `skills` or a top-level skill group. */
function skillsDiagnostics(skills: unknown, at: string, label: string): AgentDiagnostic[] {
  if (!Array.isArray(skills)) return [];
  const seen = new Set<string>();
  return skills.flatMap((entry, index): AgentDiagnostic[] => {
    const where = `${at}/${index}`, fail = (message: string) => [diagnostic('error', 'invalid-skills', where, `${label} ${message}`)];
    if (typeof entry === 'string') {
      if (entry.trim() === '') return fail('has an empty skills entry.');
      if (entry !== 'local' && sourceUrl(entry) && !URL.canParse(entry)) return fail(`has invalid skills source URL '${entry}'.`);
      return [];
    }
    const skill = record(entry), name = typeof skill.name === 'string' ? skill.name : '';
    if (name.trim() === '') return fail('has an inline skill with no name.');
    if (/\s/.test(name)) return fail(`inline skill '${name}' must not have whitespace in its name: it doubles as the /${name} command.`);
    if (!text(skill.description)) return fail(`inline skill '${name}' is missing a description.`);
    if (!text(skill.instructions)) return fail(`inline skill '${name}' is missing instructions.`);
    if (skill.context !== undefined && skill.context !== 'fork') return fail(`inline skill '${name}' has invalid context '${String(skill.context)}' (only 'fork' is supported).`);
    if (skill.context !== 'fork' && stringList(skill.toolsets).length > 0) return fail(`inline skill '${name}' declares toolsets but is not a fork skill (set context: fork).`);
    if (skill.context !== 'fork' && stringList(skill.allowed_tools).length > 0) return fail(`inline skill '${name}' declares allowed_tools but is not a fork skill (set context: fork).`);
    if (seen.has(name)) return fail(`has duplicate inline skill '${name}'.`);
    seen.add(name);
    return [];
  });
}

const localPath = (path: string) => path.trim() !== '' && !/^(?:[\\/]|[A-Za-z]:)/.test(path) && !path.split(/[\\/]/).includes('..');

function referenceDiagnostics(config: AgentConfigDocument, name: string, agent: Record<string, unknown>): AgentDiagnostic[] {
  const names = new Set(Object.keys(record(config.agents)));
  return (['sub_agents', 'handoffs'] as const).flatMap(field => stringList(agent[field]).flatMap((reference, index) => {
    const at = pointer('agents', name, field, index), kind = field === 'sub_agents' ? 'sub-agent' : 'handoff agent';
    if (!names.has(reference) && !isExternalReference(reference)) return [diagnostic('error', 'unknown-agent-reference', at, `agent '${name}' references non-existent ${kind} '${reference}'.`)];
    const external = isExternalReference(reference) ? externalAgentReference(reference).name : undefined;
    return external !== undefined && names.has(external)
      ? [diagnostic('error', 'external-agent-conflict', at, `agent '${name}': external ${kind} '${reference}' resolves to name '${external}' which conflicts with a locally-defined agent.`)] : [];
  }));
}

function definitionDiagnostics(config: AgentConfigDocument, name: string, agent: Record<string, unknown>): AgentDiagnostic[] {
  const groups: Array<[field: string, section: string, code: string, kind: string]> = [
    ['use_toolsets', 'toolsets', 'unknown-toolset', 'toolset'], ['use_commands', 'commands', 'unknown-command-group', 'command group'], ['use_skills', 'skills', 'unknown-skill-group', 'skill group'],
  ];
  const problems = groups.flatMap(([field, section, code, kind]) => stringList(agent[field]).flatMap((reference, index) => Object.hasOwn(record(config[section]), reference) ? []
    : [diagnostic('error', code, pointer('agents', name, field, index), `agent '${name}' references non-existent ${kind} '${reference}'.`)]));
  (Array.isArray(agent.toolsets) ? agent.toolsets : []).forEach((toolset, index) => {
    const { type, ref } = record(toolset);
    if (typeof ref !== 'string' || ref === '') return;
    if (type === 'mcp' && !ref.startsWith('docker:') && !Object.hasOwn(record(config.mcps), ref)) problems.push(diagnostic('error', 'unknown-mcp-definition', pointer('agents', name, 'toolsets', index, 'ref'), `agent '${name}' references non-existent MCP definition '${ref}'.`));
    if (type === 'rag' && !Object.hasOwn(record(config.rag), ref)) problems.push(diagnostic('error', 'unknown-rag-definition', pointer('agents', name, 'toolsets', index, 'ref'), `agent '${name}' references non-existent RAG definition '${ref}'.`));
  });
  // Inline fork skills, including those merged from use_skills groups, may only name top-level toolsets.
  const inline = [agent.skills, ...stringList(agent.use_skills).map(group => record(config.skills)[group])].flatMap(skills => Array.isArray(skills) ? skills.filter(isObject) : []);
  for (const skill of inline) for (const ref of stringList(skill.toolsets)) if (!Object.hasOwn(record(config.toolsets), ref)) {
    problems.push(diagnostic('error', 'unknown-toolset', pointer('agents', name, 'skills'), `agent '${name}' inline skill '${String(skill.name)}' references non-existent toolset '${ref}'.`));
  }
  return problems;
}

function agentDiagnostics(config: AgentConfigDocument, name: string, agent: Record<string, unknown>): AgentDiagnostic[] {
  const at = pointer('agents', name), problems = [...harnessDiagnostics(agent, at)];
  if (agent.instruction !== undefined && agent.instruction !== '' && agent.instruction_file !== undefined) {
    problems.push(diagnostic('error', 'instruction-conflict', `${at}/instruction_file`, `agent '${name}': 'instruction' and 'instruction_file' are mutually exclusive, set only one.`));
  }
  instructionFiles(agent).forEach((path, index) => {
    if (!localPath(path)) problems.push(diagnostic('error', 'invalid-instruction-file', typeof agent.instruction_file === 'string' ? `${at}/instruction_file` : `${at}/instruction_file/${index}`, `instruction_file "${path}" must be a local relative path inside the config directory.`));
  });
  for (const budget of stringList(agent.budgets)) if (!Object.hasOwn(record(config.budgets), budget)) {
    problems.push(diagnostic('error', 'unknown-budget', `${at}/budgets`, `agents.${name}: budgets: unknown budget "${budget}"; define it under the top-level 'budgets'.`));
  }
  if (!isObject(agent.harness) && typeof agent.model === 'string') {
    for (const model of expandModelReference(config, agent.model)) if (!modelResolves(config, model)) {
      problems.push(diagnostic('error', 'unknown-model', `${at}/model`, `agent '${name}' references non-existent model '${model}'.`));
    }
  }
  (Array.isArray(agent.toolsets) ? agent.toolsets : []).forEach((toolset, index) => problems.push(...toolsetDiagnostics(toolset, `${at}/toolsets/${index}`)));
  return [...problems, ...definitionDiagnostics(config, name, agent), ...referenceDiagnostics(config, name, agent), ...skillsDiagnostics(agent.skills, `${at}/skills`, `agent '${name}'`)];
}

/** `force_handoff` targets exist, never the agent itself, and local chains never form a cycle. */
function forceHandoffDiagnostics(config: AgentConfigDocument): AgentDiagnostic[] {
  const names = new Set(Object.keys(record(config.agents)));
  const problems: AgentDiagnostic[] = [], edges = new Map<string, string>();
  for (const [name, agent] of agentEntries(config)) {
    const target = agent.force_handoff, at = pointer('agents', name, 'force_handoff');
    if (typeof target !== 'string' || target === '') continue;
    const external = isExternalReference(target);
    if (target === name) problems.push(diagnostic('error', 'force-handoff-self', at, `agent '${name}' cannot force_handoff to itself.`));
    else if (!names.has(target) && !external) problems.push(diagnostic('error', 'unknown-agent-reference', at, `agent '${name}' references non-existent force_handoff agent '${target}'.`));
    else if (external && names.has(externalAgentReference(target).name)) problems.push(diagnostic('error', 'external-agent-conflict', at, `agent '${name}': external force_handoff '${target}' resolves to name '${externalAgentReference(target).name}' which conflicts with a locally-defined agent.`));
    if (!external && target !== name) edges.set(name, target);
  }
  // Each agent has at most one outgoing edge, so walking every chain finds each cycle; report it once.
  const reported = new Set<string>();
  for (const start of edges.keys()) {
    const visited = new Set([start]);
    for (let current = edges.get(start); current !== undefined; current = edges.get(current)) {
      if (!visited.has(current)) { visited.add(current); continue; }
      const cycle = [current];
      for (let next = edges.get(current)!; next !== current; next = edges.get(next)!) cycle.push(next);
      if (!cycle.some(member => reported.has(member))) {
        problems.push(diagnostic('error', 'force-handoff-cycle', pointer('agents', current, 'force_handoff'), `force_handoff cycle detected involving agents ${cycle.map(member => `'${member}'`).join(', ')}.`));
      }
      for (const member of cycle) reported.add(member);
      break;
    }
  }
  return problems;
}
