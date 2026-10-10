import { diagnostic, isObject, record, text, type AgentDiagnostic } from './config.ts';

/**
 * Toolset, harness and model rules that docker-agent enforces while decoding a configuration
 * (`pkg/config/latest/validate.go` at the vendored commit) and that the JSON Schema does not express.
 */
type Rule = readonly [field: string, types: readonly string[], set?: (value: unknown) => boolean];
const present = (value: unknown) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0) && !(isObject(value) && Object.keys(value).length === 0);
const enabled = (value: unknown) => value === true;
const fieldRules: readonly Rule[] = [
  ['shell', ['script']], ['path', ['memory', 'tasks']], ['post_edit', ['filesystem', 'file']], ['ignore_vcs', ['filesystem']],
  ['allow_list', ['filesystem', 'file']], ['deny_list', ['filesystem', 'file']],
  ['env', ['shell', 'background_jobs', 'script', 'mcp', 'lsp']], ['file_types', ['lsp']],
  ['allowed_servers', ['mcp_catalog']], ['blocked_servers', ['mcp_catalog']], ['max_output_bytes', ['openapi']],
  ['escape_html', ['fetch']], ['allowed_domains', ['fetch']], ['blocked_domains', ['fetch']],
  ['allow_private_ips', ['fetch', 'mcp', 'api', 'openapi', 'a2a'], enabled], ['sudo_askpass', ['shell']], ['recall', ['background_jobs']],
  ['models', ['model_picker']], ['shared', ['todo'], enabled], ['version', ['mcp', 'lsp']], ['command', ['mcp', 'lsp']],
  ['args', ['mcp', 'lsp']], ['ref', ['mcp', 'rag']], ['headers', ['openapi', 'a2a', 'fetch']], ['config', ['mcp']],
  ['url', ['a2a', 'openapi', 'open_url']], ['name', ['mcp', 'a2a', 'rag', 'open_url']], ['rag_config', ['rag']],
  ['working_dir', ['mcp', 'lsp']], ['lifecycle', ['mcp', 'lsp']],
];
const listTypes = (types: readonly string[]) => types.map(type => `'${type}'`).join(', ');

function cidr(pattern: string): boolean {
  const [address, prefix, ...rest] = pattern.split('/');
  if (rest.length > 0 || !/^\d{1,3}$/.test(prefix ?? '')) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address!)) return address!.split('.').every(part => Number(part) <= 255) && Number(prefix) <= 32;
  return /^[0-9a-fA-F:]+$/.test(address!) && address!.includes(':') && Number(prefix) <= 128;
}

function entries(field: string, value: unknown, at: string, check?: (entry: string) => string | undefined): AgentDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') return [diagnostic('error', 'invalid-toolset', `${at}/${field}/${index}`, `${field}[${index}] must not be empty.`)];
    const problem = check?.(entry.trim());
    return problem ? [diagnostic('error', 'invalid-toolset', `${at}/${field}/${index}`, `${field}[${index}] "${entry}" is invalid: ${problem}`)] : [];
  });
}

function domainPattern(pattern: string): string | undefined {
  if (pattern.includes('/')) return cidr(pattern) ? undefined : 'not a valid CIDR.';
  if (pattern.includes('*') && !/^\*\.[^*]+$/.test(pattern)) return "'*' is only allowed as a leading '*.' wildcard, e.g. '*.example.com'.";
  return undefined;
}

function loopback(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  return name === 'localhost' || name === '::1' || /^127(?:\.\d{1,3}){3}$/.test(name);
}

function oauth(remote: Record<string, unknown>, at: string): AgentDiagnostic[] {
  const settings = record(remote.oauth);
  const where = `${at}/remote/oauth`;
  if (!isObject(remote.oauth)) return [];
  if (!text(remote.url)) return [diagnostic('error', 'invalid-toolset', where, 'oauth requires remote url to be set.')];
  if (!text(settings.clientId) && text(settings.clientSecret)) return [diagnostic('error', 'invalid-toolset', where, 'oauth clientSecret requires clientId to be set.')];
  if (typeof settings.callbackRedirectURL === 'string' && settings.callbackRedirectURL !== '') {
    let url: URL | undefined;
    try { url = new URL(settings.callbackRedirectURL.replaceAll('${callbackPort}', '1')); } catch { url = undefined; }
    if (!url || !['http:', 'https:'].includes(url.protocol)) return [diagnostic('error', 'invalid-toolset', `${where}/callbackRedirectURL`, 'oauth callbackRedirectURL must be an absolute http or https URL.')];
    if (url.protocol === 'http:' && !loopback(url.hostname)) return [diagnostic('error', 'invalid-toolset', `${where}/callbackRedirectURL`, 'oauth callbackRedirectURL must use https for non-loopback hosts.')];
  }
  return [];
}

function typeRequirements(toolset: Record<string, unknown>, at: string): AgentDiagnostic[] {
  const type = toolset.type, remote = record(toolset.remote);
  const fail = (message: string, field = '') => [diagnostic('error', 'invalid-toolset', `${at}${field}`, message)];
  if (type === 'mcp') {
    const sources = [text(toolset.command), text(remote.url), text(toolset.ref)].filter(Boolean).length;
    if (sources !== 1) return fail(sources === 0 ? 'either command, remote or ref must be set.' : 'either command, remote or ref must be set, but only one of those.');
    if (enabled(toolset.allow_private_ips) && !text(remote.url) && !text(toolset.ref)) return fail("allow_private_ips can only be used with type 'fetch', 'api', 'openapi', 'a2a' or remote MCP toolsets.", '/allow_private_ips');
    if (present(toolset.working_dir) && text(remote.url)) return fail('working_dir is not valid for remote MCP toolsets (no local subprocess).', '/working_dir');
    return oauth(remote, at);
  }
  const required: Record<string, string> = { a2a: 'url', lsp: 'command', openapi: 'url', open_url: 'url' };
  if (typeof type === 'string' && Object.hasOwn(required, type) && !text(toolset[required[type]!])) return fail(`${type} toolset requires a ${required[type]} to be set.`);
  if (type === 'model_picker' && !present(toolset.models)) return fail("model_picker toolset requires at least one model in the 'models' list.");
  if (type === 'rag' && !text(toolset.ref) && !isObject(toolset.rag_config)) return fail('rag toolset requires either ref or rag_config.');
  return [];
}

/** docker-agent's `Toolset.validate`: fields used on the wrong type and the sources each type requires. */
export function toolsetDiagnostics(toolset: unknown, at: string): AgentDiagnostic[] {
  if (!isObject(toolset)) return [];
  const type = String(toolset.type ?? '');
  const misplaced = fieldRules.filter(([field, types, set = present]) => set(toolset[field]) && !types.includes(type))
    .map(([field, types]) => diagnostic('error', 'invalid-toolset', `${at}/${field}`, `${field} can only be used with type ${listTypes(types)}.`));
  const remote = record(toolset.remote);
  if ((present(remote.url) || present(remote.transport_type) || present(remote.oauth)) && type !== 'mcp') misplaced.push(diagnostic('error', 'invalid-toolset', `${at}/remote`, "remote can only be used with type 'mcp'."));
  if (present(remote.headers) && type !== 'mcp' && type !== 'a2a') misplaced.push(diagnostic('error', 'invalid-toolset', `${at}/remote/headers`, "remote headers can only be used with type 'mcp' or 'a2a'."));
  if (present(toolset.allowed_domains) && present(toolset.blocked_domains)) misplaced.push(diagnostic('error', 'invalid-toolset', at, 'allowed_domains and blocked_domains are mutually exclusive.'));
  return [
    ...misplaced,
    ...['allow_list', 'deny_list', 'allowed_servers', 'blocked_servers'].flatMap(field => entries(field, toolset[field], at)),
    ...['allowed_domains', 'blocked_domains'].flatMap(field => entries(field, toolset[field], at, domainPattern)),
    ...(typeof toolset.max_output_bytes === 'number' && toolset.max_output_bytes < 0 ? [diagnostic('error', 'invalid-toolset', `${at}/max_output_bytes`, 'max_output_bytes must not be negative.')] : []),
    ...typeRequirements(toolset, at),
  ];
}

/** docker-agent's harness rules: the external CLI owns compaction and the tool loop. */
export function harnessDiagnostics(agent: Record<string, unknown>, at: string): AgentDiagnostic[] {
  if (!isObject(agent.harness)) return [];
  const harness = agent.harness, where = `${at}/harness`;
  const fail = (message: string, field = '') => diagnostic('error', 'invalid-harness', `${where}${field}`, message);
  const problems: AgentDiagnostic[] = [];
  if (text(agent.compaction_model)) problems.push(diagnostic('error', 'invalid-harness', `${at}/compaction_model`, 'compaction_model cannot be used with a harness; the harness manages its own context compaction.'));
  if (record(agent.structured_output).mode === 'tool') problems.push(diagnostic('error', 'invalid-harness', `${at}/structured_output/mode`, "structured_output.mode 'tool' cannot be used with a harness; use mode 'native'."));
  if (text(harness.effort) && harness.type !== 'claude-code') problems.push(fail("harness.effort can only be used with harness.type 'claude-code'.", '/effort'));
  if (text(harness.agent) && harness.type !== 'opencode') problems.push(fail("harness.agent can only be used with harness.type 'opencode'.", '/agent'));
  if (harness.thinking === true && harness.type !== 'opencode') problems.push(fail("harness.thinking can only be used with harness.type 'opencode'.", '/thinking'));
  return problems;
}

const selectorConflicts = ['provider', 'model', 'temperature', 'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty', 'base_url', 'token_key',
  'bypass_models_gateway', 'provider_opts', 'track_usage', 'thinking_budget', 'task_budget', 'auth', 'routing', 'title_model', 'compaction_model',
  'compaction_threshold', 'cost', 'output_capabilities'];

/** docker-agent's model rules: `first_available` selectors stand alone, and compaction thresholds lie in (0, 1]. */
export function modelDiagnostics(model: unknown, at: string): AgentDiagnostic[] {
  if (!isObject(model)) return [];
  const problems: AgentDiagnostic[] = [];
  const threshold = model.compaction_threshold;
  if (typeof threshold === 'number' && (threshold <= 0 || threshold > 1)) problems.push(diagnostic('error', 'invalid-model', `${at}/compaction_threshold`, `compaction_threshold must be greater than 0 and at most 1, got ${threshold}.`));
  if (!Array.isArray(model.first_available)) return problems;
  if (model.first_available.length === 0) return [...problems, diagnostic('error', 'invalid-model', `${at}/first_available`, 'first_available must contain at least one candidate.')];
  // Go compares pointers with nil, so an explicit false or 0 conflicts too; bypass_models_gateway is a plain bool.
  const conflict = selectorConflicts.find(field => field === 'bypass_models_gateway' ? model[field] === true : present(model[field]) || model[field] === false || model[field] === 0);
  if (conflict) problems.push(diagnostic('error', 'invalid-model', `${at}/${conflict}`, `first_available cannot be combined with ${conflict}.`));
  model.first_available.forEach((candidate, index) => {
    if (typeof candidate !== 'string' || candidate.trim() === '') problems.push(diagnostic('error', 'invalid-model', `${at}/first_available/${index}`, `first_available[${index}] must not be empty.`));
  });
  return problems;
}
