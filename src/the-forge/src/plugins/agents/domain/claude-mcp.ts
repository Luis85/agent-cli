import { diagnostic, isObject, record, stringList, text, type AgentDiagnostic } from './config.ts';
import { mcpVariables } from './templating.ts';

/**
 * One MCP server as Claude Code configures it inline on an agent or in the project's `.mcp.json`. `declared` is the
 * name docker-agent knows it by (`mcp:<declared>:<tool>` permissions), `name` the generated Claude server name, `at`
 * the toolset's JSON pointer and `commandLine` the process a stdio server starts.
 */
export interface McpServer { name: string; declared: string; at: string; config: Record<string, unknown>; commandLine?: string }

/** A command and its arguments as one shell-readable line; arguments with other characters are double-quoted. */
function commandLine(command: string, args: readonly string[] = []): string {
  return [command, ...args].map(part => /^[\w@%+=:,./${}~-]+$/.test(part) ? part : JSON.stringify(part)).join(' ');
}

const launchers = ['npx', 'uvx', 'bunx', 'pnpx', 'pipx'];
const unsupported: Readonly<Record<string, string>> = {
  version: 'auto-installation versions', working_dir: 'working directories', lifecycle: 'lifecycle policies', allow_private_ips: 'private IP access',
  config: 'Docker MCP server configuration',
};

/** A server name for `mcp__<server>__<tool>`: letters, digits, hyphens and underscores. */
const serverName = (name: string) => name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp';

function derivedName(toolset: Record<string, unknown>): string {
  if (text(toolset.name)) return toolset.name;
  if (typeof toolset.ref === 'string' && toolset.ref.startsWith('docker:')) return toolset.ref.slice('docker:'.length);
  const remote = record(toolset.remote);
  if (text(remote.url)) {
    try { return new URL(remote.url).hostname.replace(/^(?:www|mcp|api)\./, '').split('.')[0]!; } catch { return 'remote'; }
  }
  const command = String(toolset.command ?? ''), args = stringList(toolset.args);
  const base = command.split(/[\\/]/).at(-1)!.replace(/\.[a-z]+$/i, '');
  const packageName = launchers.includes(base) ? args.find(arg => !arg.startsWith('-')) : undefined;
  return packageName ? packageName.replace(/@[^@/]*$/, '').split('/').at(-1)!.replace(/^(?:mcp-)?server-/, '') : base;
}

/** Converts template variables in MCP strings; expressions without a Claude form stay literal with a warning. */
function variables(value: string, at: string, diagnostics: AgentDiagnostic[]): string {
  const converted = mcpVariables(value);
  for (const kept of converted.kept) diagnostics.push(diagnostic('warning', 'template-literal', at, `The template expression ${kept} has no Claude MCP equivalent and is kept literally.`, 'U'));
  return converted.text;
}
function variableMap(value: unknown, at: string, diagnostics: AgentDiagnostic[]): Record<string, string> | undefined {
  if (!isObject(value) || Object.keys(value).length === 0) return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, variables(String(entry), `${at}/${key}`, diagnostics)]));
}

function remoteServer(remote: Record<string, unknown>, at: string, diagnostics: AgentDiagnostic[]): Record<string, unknown> {
  const type = remote.transport_type === 'sse' ? 'sse' : 'http';
  const headers = variableMap(remote.headers, `${at}/remote/headers`, diagnostics);
  const oauth = record(remote.oauth), mapped: Record<string, unknown> = {};
  if (text(oauth.clientId)) mapped.clientId = oauth.clientId;
  if (typeof oauth.callbackPort === 'number') mapped.callbackPort = oauth.callbackPort;
  for (const field of ['clientSecret', 'scopes', 'callbackRedirectURL']) if (oauth[field] !== undefined) {
    diagnostics.push(diagnostic('warning', 'mcp-oauth-unsupported', `${at}/remote/oauth/${field}`, `OAuth ${field} is not emitted; Claude Code asks for client secrets interactively and negotiates scopes and redirects itself.`, 'U'));
  }
  return { type, url: variables(String(remote.url), `${at}/remote/url`, diagnostics), ...(headers ? { headers } : {}), ...(Object.keys(mapped).length > 0 ? { oauth: mapped } : {}) };
}

/**
 * The Claude MCP server of a docker-agent `mcp` toolset: stdio commands and remote servers map directly, and a
 * `docker:<name>` ref runs through the Docker MCP Gateway. `taken` lists names already used by the same agent.
 */
export function mcpServer(toolset: Record<string, unknown>, at: string, taken: readonly string[]): { server?: McpServer; diagnostics: AgentDiagnostic[] } {
  const diagnostics: AgentDiagnostic[] = [], declared = derivedName(toolset);
  let name = serverName(declared);
  for (let index = 2; taken.includes(name); index++) name = `${serverName(declared)}-${index}`;
  for (const [field, label] of Object.entries(unsupported)) if (toolset[field] !== undefined) {
    diagnostics.push(diagnostic('info', 'toolset-field-unsupported', `${at}/${field}`, `MCP ${label} (${field}) have no Claude equivalent and are not emitted.`, 'U'));
  }
  const env = variableMap(toolset.env, `${at}/env`, diagnostics);
  const args = stringList(toolset.args).map((arg, index) => variables(arg, `${at}/args/${index}`, diagnostics));
  const remote = record(toolset.remote);
  if (text(remote.url)) return { server: { name, declared, at, config: remoteServer(remote, at, diagnostics) }, diagnostics };
  if (typeof toolset.ref === 'string' && toolset.ref.startsWith('docker:')) {
    const gateway = ['mcp', 'gateway', 'run', '--servers', toolset.ref.slice('docker:'.length)];
    diagnostics.push(diagnostic('warning', 'mcp-docker-gateway', `${at}/ref`, `${toolset.ref} runs through the Docker MCP Gateway: ${commandLine('docker', gateway)}.`, 'A'));
    return { server: { name, declared, at: `${at}/ref`, config: { type: 'stdio', command: 'docker', args: gateway, ...(env ? { env } : {}) }, commandLine: commandLine('docker', gateway) }, diagnostics };
  }
  if (!text(toolset.command)) return { diagnostics: [...diagnostics, diagnostic('warning', 'toolset-unsupported', at, 'The MCP toolset has no command, remote URL or Docker ref and is not emitted.', 'U')] };
  const command = variables(toolset.command, `${at}/command`, diagnostics);
  return { server: { name, declared, at, config: { type: 'stdio', command, ...(args.length > 0 ? { args } : {}), ...(env ? { env } : {}) }, commandLine: commandLine(command, args) }, diagnostics };
}
