import { AppError, ensure, forgeError, isRecord } from '../../../domain/shared/errors.ts';
import { validateClaudeHooks } from '../../../domain/claude/hooks.ts';

/** Discovery metadata describes Claude's loading behavior, not features executed by Forge. */
export const claudePluginCapabilities = {
  manifest: '.claude-plugin/plugin.json',
  manifestRequired: false,
  reference: 'https://code.claude.com/docs/en/plugins-reference',
  validation: 'Known manifest shapes and contained relative paths; unknown fields are preserved. Referenced files, installed versions and runtime behavior require Claude Code validation.',
  components: [
    { field: 'skills', defaultPath: 'skills/', forms: ['path', 'paths'], loading: 'add' },
    { field: 'commands', defaultPath: 'commands/', forms: ['path', 'paths', 'command-map'], loading: 'replace' },
    { field: 'agents', defaultPath: 'agents/', forms: ['markdown-file', 'markdown-files'], loading: 'replace' },
    { field: 'hooks', defaultPath: 'hooks/hooks.json', forms: ['json-path', 'event-map', 'mixed-array'], loading: 'merge' },
    { field: 'mcpServers', defaultPath: '.mcp.json', forms: ['json-path', 'bundle-path', 'https-bundle-url', 'server-map', 'mixed-array'], loading: 'merge' },
    { field: 'lspServers', defaultPath: '.lsp.json', forms: ['json-path', 'server-map', 'mixed-array'], loading: 'merge' },
    { field: 'outputStyles', defaultPath: 'output-styles/', forms: ['path', 'paths'], loading: 'replace' },
    { field: 'workflows', defaultPath: 'workflows/', forms: ['path', 'paths'], loading: 'replace' },
    { field: 'settings', defaultPath: 'settings.json', forms: ['object'], loading: 'file-over-manifest' },
    { field: 'experimental.themes', defaultPath: 'themes/', forms: ['path', 'paths'], loading: 'replace' },
    { field: 'experimental.monitors', defaultPath: 'monitors/monitors.json', forms: ['json-path', 'monitor-array'], loading: 'replace' },
    { field: 'experimental.evals', defaultPath: 'evals/', forms: ['path', 'paths'], loading: 'first-path' },
    { field: 'types', forms: ['declaration-file'], loading: 'explicit' },
    { field: 'channels', forms: ['channel-array'], loading: 'explicit' },
    { field: null, defaultPath: 'bin/', forms: ['executables'], loading: 'append-to-shell-path' },
  ],
  supportedSettings: ['agent', 'subagentStatusLine'],
  ignoredPluginAgentFields: ['hooks', 'mcpServers', 'permissionMode', 'initialPrompt'],
  memoryScopes: ['user', 'project', 'local'],
  limits: [
    'Plugin hooks and MCP servers apply to the enabled plugin, not only its agents.',
    'Persistent agent memory has no effect when Claude auto memory is disabled.',
    'LSP configuration does not install the language-server executable.',
    'Experimental monitors require interactive sessions and are unavailable on supported third-party model platforms.',
    'Claude may reject unknown nested fields or ignore unknown settings that Forge preserves.',
  ],
} as const;

function check(condition: unknown, path: string, requirement: string): asserts condition {
  ensure(condition, 'INVALID_CLAUDE_PLUGIN', `${path}: ${requirement}`);
}
function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  check(isRecord(value), path, 'must be an object.');
}
function jsonValue(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  check(depth < 100, 'plugin', 'JSON nesting is too deep.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { check(Number.isFinite(value), 'plugin', 'numbers must be finite.'); return; }
  check(typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'plugin', 'must contain JSON-compatible data.');
  check(!ancestors.has(value), 'plugin', 'must not contain circular references.');
  ancestors.add(value);
  for (const child of Object.values(value)) jsonValue(child, ancestors, depth + 1);
  ancestors.delete(value);
}
function text(value: unknown, path: string, nonempty = false): asserts value is string {
  check(typeof value === 'string' && (!nonempty || value.trim().length > 0), path, `must be ${nonempty ? 'a nonempty' : 'a'} string.`);
}
function strings(value: unknown, path: string): asserts value is string[] {
  check(Array.isArray(value) && value.every(item => typeof item === 'string'), path, 'must be an array of strings.');
}
function optionalStrings(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  for (const field of fields) if (value[field] !== undefined) text(value[field], `${path}.${field}`);
}
function optionalBooleans(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  for (const field of fields) if (value[field] !== undefined) check(typeof value[field] === 'boolean', `${path}.${field}`, 'must be a boolean.');
}
function stringMap(value: unknown, path: string): asserts value is Record<string, string> {
  object(value, path);
  for (const [key, item] of Object.entries(value)) text(item, `${path}.${key}`);
}
function pluginName(value: unknown, path: string): void {
  text(value, path, true);
  // oxlint-disable-next-line no-control-regex -- Names must exclude control and bidirectional formatting characters.
  check(!/[\s@:/\\\x00-\x1f\x7f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value), path, 'must contain no whitespace, @, colon, path separators, control or bidirectional formatting characters; use kebab-case.');
}
function componentPath(value: unknown, path: string, extensions?: readonly string[], allowRoot = false, prefixRequired = true): void {
  text(value, path, true);
  if (allowRoot && value === '.') return;
  // oxlint-disable-next-line no-control-regex -- Components must use contained relative paths without controls.
  check(!/[\\:\x00-\x1f\x7f]/.test(value) && !value.startsWith('/') && !value.split('/').includes('..'), path, 'must remain inside the plugin root.');
  check(!prefixRequired || value.startsWith('./'), path, 'must start with ./ and be relative to the plugin root.');
  if (extensions) check(extensions.some(extension => value.endsWith(extension)), path, `must end with ${extensions.join(' or ')}.`);
}
function paths(value: unknown, path: string, extensions?: readonly string[], allowRoot = false, prefixRequired = true): void {
  if (!Array.isArray(value)) { componentPath(value, path, extensions, allowRoot, prefixRequired); return; }
  value.forEach((item, index) => componentPath(item, `${path}[${index}]`, extensions, allowRoot, prefixRequired));
}
function mixed(value: unknown, path: string, validatePath: (value: string, path: string) => void, validateInline: (value: unknown, path: string) => void): void {
  const entries = Array.isArray(value) ? value : [value];
  entries.forEach((entry, index) => {
    const location = Array.isArray(value) ? `${path}[${index}]` : path;
    if (typeof entry === 'string') validatePath(entry, location);
    else validateInline(entry, location);
  });
}
function noShellOptions(value: unknown, path: string): void {
  if (typeof value === 'string') check(!value.includes('${user_config.'), path, 'cannot substitute user_config values into a shell command.');
}
function commands(value: unknown, path: string): void {
  if (typeof value === 'string' || Array.isArray(value)) { paths(value, path); return; }
  object(value, path);
  for (const [name, entry] of Object.entries(value)) {
    const location = `${path}.${name}`;
    object(entry, location);
    check((entry.source !== undefined) !== (entry.content !== undefined), location, 'must define exactly one of source or content.');
    if (entry.source !== undefined) componentPath(entry.source, `${location}.source`, ['.md']);
    optionalStrings(entry, ['content', 'description', 'argumentHint', 'model'], location);
    if (entry.allowedTools !== undefined) strings(entry.allowedTools, `${location}.allowedTools`);
  }
}
function mcpServers(value: unknown, path: string): void {
  object(value, path);
  for (const [name, server] of Object.entries(value)) {
    const location = `${path}.${name}`;
    object(server, location);
    optionalStrings(server, ['type', 'command', 'url', 'headersHelper', 'cwd'], location);
    if (server.type !== undefined) check(['stdio', 'http', 'sse'].includes(server.type as string), `${location}.type`, 'must be stdio, http, or sse.');
    if (server.type === undefined || server.type === 'stdio') text(server.command, `${location}.command`, true);
    else if (server.type === 'http' || server.type === 'sse') text(server.url, `${location}.url`, true);
    if (server.args !== undefined) strings(server.args, `${location}.args`);
    for (const key of ['env', 'headers']) if (server[key] !== undefined) stringMap(server[key], `${location}.${key}`);
    noShellOptions(server.headersHelper, `${location}.headersHelper`);
    if (server.oauth !== undefined) {
      object(server.oauth, `${location}.oauth`);
      optionalStrings(server.oauth, ['clientId', 'authServerMetadataUrl', 'scopes'], `${location}.oauth`);
      if (server.oauth.callbackPort !== undefined) check(Number.isInteger(server.oauth.callbackPort) && Number(server.oauth.callbackPort) > 0 && Number(server.oauth.callbackPort) <= 65535, `${location}.oauth.callbackPort`, 'must be an integer between 1 and 65535.');
    }
  }
}
function mcpPath(value: string, path: string): void {
  if (value.startsWith('https://')) {
    let parsed: URL | undefined;
    try { parsed = new URL(value); } catch { /* Report a domain error below. */ }
    check(parsed && /\.(mcpb|dxt)$/.test(parsed.pathname), path, 'must be an HTTPS URL for a .mcpb or .dxt bundle.');
  } else componentPath(value, path, ['.json', '.mcpb', '.dxt']);
}
function lspServers(value: unknown, path: string): void {
  object(value, path);
  for (const [name, server] of Object.entries(value)) {
    const location = `${path}.${name}`;
    object(server, location);
    text(server.command, `${location}.command`, true);
    check(server.command.startsWith('/') || !/\s/.test(server.command), `${location}.command`, 'must name a binary; put arguments in args.');
    stringMap(server.extensionToLanguage, `${location}.extensionToLanguage`);
    check(Object.keys(server.extensionToLanguage).length > 0 && Object.entries(server.extensionToLanguage).every(([extension, language]) => extension.startsWith('.') && language.length > 0), `${location}.extensionToLanguage`, 'must map at least one dot-prefixed extension to a language.');
    if (server.args !== undefined) strings(server.args, `${location}.args`);
    if (server.env !== undefined) stringMap(server.env, `${location}.env`);
    if (server.transport !== undefined) check(typeof server.transport === 'string' && ['stdio', 'socket'].includes(server.transport), `${location}.transport`, 'must be stdio or socket.');
    optionalStrings(server, ['workspaceFolder'], location);
    optionalBooleans(server, ['restartOnCrash', 'diagnostics'], location);
    for (const key of ['startupTimeout', 'shutdownTimeout', 'requestTimeout', 'maxRestarts']) {
      if (server[key] !== undefined) check(Number.isInteger(server[key]) && Number(server[key]) >= (key === 'maxRestarts' ? 0 : 1), `${location}.${key}`, 'must be an integer within the supported nonnegative/positive range.');
    }
  }
}
function userConfig(value: unknown, path: string): void {
  object(value, path);
  for (const [name, option] of Object.entries(value)) {
    const location = `${path}.${name}`;
    check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name), location, 'option keys must be identifiers and cannot start with a digit.');
    object(option, location);
    check(typeof option.type === 'string' && ['string', 'number', 'boolean', 'directory', 'file'].includes(option.type), `${location}.type`, 'must be string, number, boolean, directory, or file.');
    text(option.title, `${location}.title`);
    text(option.description, `${location}.description`);
    optionalBooleans(option, ['required', 'multiple', 'sensitive'], location);
    for (const key of ['min', 'max']) if (option[key] !== undefined) check(typeof option[key] === 'number' && Number.isFinite(option[key]), `${location}.${key}`, 'must be a finite number.');
    if (option.min !== undefined && option.max !== undefined) check(Number(option.min) <= Number(option.max), location, 'min cannot exceed max.');
    if (option.default !== undefined) {
      const initial = option.default;
      check(typeof initial === 'string' || typeof initial === 'boolean' || (typeof initial === 'number' && Number.isFinite(initial)) || (Array.isArray(initial) && initial.every(item => typeof item === 'string')), `${location}.default`, 'must be a string, finite number, boolean, or string array.');
    }
    if (option.options !== undefined) {
      strings(option.options, `${location}.options`);
      check(option.type === 'string' && option.multiple !== true && option.sensitive !== true, location, 'options require a single, non-sensitive string.');
      check(option.options.length > 0 && option.options.every(item => item.length >= 1 && item.length <= 64), `${location}.options`, 'must contain labels of 1 to 64 characters.');
      check(option.default === undefined ? option.required === true : typeof option.default === 'string' && option.options.includes(option.default), location, 'options require a listed default or required: true.');
    }
  }
}
function monitors(value: unknown, path: string): void {
  if (typeof value === 'string') { componentPath(value, path, ['.json']); return; }
  check(Array.isArray(value), path, 'must be a JSON path or an array of monitors.');
  const names = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const location = `${path}[${index}]`;
    object(entry, location);
    text(entry.name, `${location}.name`, true);
    check(!names.has(entry.name), `${location}.name`, 'must be unique within the plugin.');
    names.add(entry.name);
    text(entry.command, `${location}.command`, true);
    text(entry.description, `${location}.description`);
    noShellOptions(entry.command, `${location}.command`);
    if (entry.when !== undefined) check(typeof entry.when === 'string' && (entry.when === 'always' || /^on-skill-invoke:.+$/.test(entry.when)), `${location}.when`, 'must be always or on-skill-invoke:<skill>.');
  }
}
function settings(value: unknown, path: string): void {
  object(value, path);
  optionalStrings(value, ['agent'], path);
  if (value.subagentStatusLine !== undefined) {
    object(value.subagentStatusLine, `${path}.subagentStatusLine`);
    check(value.subagentStatusLine.type === 'command', `${path}.subagentStatusLine.type`, 'must be command.');
    text(value.subagentStatusLine.command, `${path}.subagentStatusLine.command`, true);
  }
}
function hooks(value: unknown, path: string): void {
  try { validateClaudeHooks(value); }
  catch (error) {
    if (error instanceof AppError) throw forgeError('INVALID_CLAUDE_PLUGIN', `${path}: ${error.message}`);
    throw error;
  }
}

/** Validate supported fields without stripping extensions, resolving paths, or running plugin code. */
export function validateClaudePlugin(value: unknown): asserts value is Record<string, unknown> {
  jsonValue(value);
  object(value, 'plugin');
  pluginName(value.name, 'plugin.name');
  optionalStrings(value, ['$schema', 'displayName', 'version', 'description', 'homepage', 'repository', 'license', 'icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl'], 'plugin');
  if (value.homepage !== undefined) check(URL.canParse(value.homepage as string), 'plugin.homepage', 'must be a valid URL.');
  if (value.keywords !== undefined) strings(value.keywords, 'plugin.keywords');
  optionalBooleans(value, ['defaultEnabled'], 'plugin');
  if (value.metadata !== undefined) object(value.metadata, 'plugin.metadata');
  if (value.author !== undefined) {
    object(value.author, 'plugin.author');
    text(value.author.name, 'plugin.author.name');
    optionalStrings(value.author, ['email', 'url'], 'plugin.author');
  }
  if (value.dependencies !== undefined) {
    check(Array.isArray(value.dependencies), 'plugin.dependencies', 'must be an array.');
    for (const [index, entry] of value.dependencies.entries()) {
      const location = `plugin.dependencies[${index}]`;
      if (typeof entry === 'string') {
        const names = entry.split('@');
        check(names.length <= 2, location, 'must be a name or name@marketplace.');
        names.forEach(name => pluginName(name, location));
      } else {
        object(entry, location);
        pluginName(entry.name, `${location}.name`);
        optionalStrings(entry, ['version'], location);
        if (entry.marketplace !== undefined) pluginName(entry.marketplace, `${location}.marketplace`);
      }
    }
  }
  for (const key of ['skills', 'agents', 'outputStyles', 'workflows', 'themes']) {
    if (value[key] !== undefined) paths(value[key], `plugin.${key}`, key === 'agents' ? ['.md'] : undefined, key === 'skills');
  }
  if (value.types !== undefined) componentPath(value.types, 'plugin.types', ['.d.ts']);
  if (value.commands !== undefined) commands(value.commands, 'plugin.commands');
  const jsonPath = (entry: string, path: string) => componentPath(entry, path, ['.json']);
  if (value.hooks !== undefined) mixed(value.hooks, 'plugin.hooks', jsonPath, hooks);
  if (value.mcpServers !== undefined) mixed(value.mcpServers, 'plugin.mcpServers', mcpPath, mcpServers);
  if (value.lspServers !== undefined) mixed(value.lspServers, 'plugin.lspServers', jsonPath, lspServers);
  if (value.settings !== undefined) settings(value.settings, 'plugin.settings');
  if (value.userConfig !== undefined) userConfig(value.userConfig, 'plugin.userConfig');
  if (value.channels !== undefined) {
    check(Array.isArray(value.channels), 'plugin.channels', 'must be an array.');
    value.channels.forEach((channel, index) => {
      const location = `plugin.channels[${index}]`;
      object(channel, location);
      text(channel.server, `${location}.server`, true);
      optionalStrings(channel, ['displayName'], location);
      if (channel.userConfig !== undefined) userConfig(channel.userConfig, `${location}.userConfig`);
    });
  }
  if (value.monitors !== undefined) monitors(value.monitors, 'plugin.monitors');
  if (value.experimental !== undefined) {
    object(value.experimental, 'plugin.experimental');
    if (value.experimental.themes !== undefined) paths(value.experimental.themes, 'plugin.experimental.themes');
    if (value.experimental.monitors !== undefined) monitors(value.experimental.monitors, 'plugin.experimental.monitors');
    if (value.experimental.evals !== undefined) paths(value.experimental.evals, 'plugin.experimental.evals', undefined, true, false);
  }
}
