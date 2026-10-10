import { forgeError, isRecord } from '../../../domain/shared/errors.ts';
import { agentError } from './errors.ts';

/**
 * Merges generated MCP servers and settings into the project's existing Claude files. Forge owns only the entries it
 * wrote, recorded with their content in the manifest `.claude/forge-generated.json`: it replaces an entry only while
 * the entry still has the recorded content, and never replaces another entry of the same name. Every other server,
 * setting and permission rule stays as it is, in its order, and the files keep their indentation and line endings.
 */
export const manifestPath = '.claude/forge-generated.json';

/** Entries of `.mcp.json` and `.claude/settings.json` that Forge wrote, with the content it wrote. */
export interface ForgeManifest { mcpServers: Record<string, unknown>; settings: { agent?: string } }
/** The other entries Forge must not replace: MCP servers by name and the settings' main agent. */
export interface ForeignEntries { servers: Record<string, unknown>; agent?: string }
export interface GeneratedSettings { permissions: Record<'allow' | 'ask' | 'deny', string[]>; agent?: string }

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function parsed(path: string, text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw forgeError('INVALID_CLAUDE_SETTINGS', `${path} is not valid JSON; fix it before generating into it.`); }
  if (!isRecord(value)) throw forgeError('INVALID_CLAUDE_SETTINGS', `${path} must contain a JSON object.`);
  return value;
}

function section(path: string, value: unknown, key: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw forgeError('INVALID_CLAUDE_SETTINGS', `${path} ${key} must be an object.`);
  return value;
}

/** JSON in the existing file's style: its indentation (spaces or a tab), line endings and final newline. */
function json(value: unknown, text: string | undefined): string {
  const indented = text === undefined ? undefined : /^([ \t]+)\S/m.exec(text)?.[1];
  const indent = indented === undefined ? 2 : indented.startsWith('\t') ? '\t' : indented.length;
  const eol = text?.includes('\r\n') ? '\r\n' : '\n';
  const final = text === undefined || /\r?\n$/.test(text) ? eol : '';
  return `${JSON.stringify(value, null, indent).replaceAll('\n', eol)}${final}`;
}

export function parseManifest(text: string | undefined): ForgeManifest {
  const value = parsed(manifestPath, text);
  const settings = section(manifestPath, value.settings, 'settings');
  return { mcpServers: section(manifestPath, value.mcpServers, 'mcpServers'), settings: typeof settings.agent === 'string' ? { agent: settings.agent } : {} };
}

/** The entries of the current files that Forge did not write, or that changed since it wrote them. */
export function foreignEntries(mcp: string | undefined, settings: string | undefined, manifest: ForgeManifest): ForeignEntries {
  const servers = section('.mcp.json', parsed('.mcp.json', mcp).mcpServers, 'mcpServers');
  const agent = parsed('.claude/settings.json', settings).agent;
  return {
    servers: Object.fromEntries(Object.entries(servers).filter(([name, config]) => !same(manifest.mcpServers[name], config))),
    ...(agent !== undefined && agent !== manifest.settings.agent ? { agent: typeof agent === 'string' ? agent : JSON.stringify(agent) } : {}),
  };
}

const conflict = (message: string, details: Record<string, unknown>) => agentError('AGENT_MERGE_CONFLICT', message, details);

/** `.mcp.json` with the generated servers set by name; a same-named server Forge does not own is a conflict. */
export function mergeMcpServers(text: string | undefined, servers: Record<string, Record<string, unknown>>, manifest: ForgeManifest): string {
  const current = parsed('.mcp.json', text), existing = section('.mcp.json', current.mcpServers, 'mcpServers');
  const foreign = Object.keys(servers).filter(name => existing[name] !== undefined && !same(existing[name], servers[name]) && !same(existing[name], manifest.mcpServers[name]));
  if (foreign.length > 0) throw conflict(`.mcp.json already defines ${foreign.join(', ')}, which Forge did not generate; rename the MCP toolsets or pass --rename-conflicts.`, { path: '.mcp.json', servers: foreign });
  return json({ ...current, mcpServers: { ...existing, ...servers } }, text);
}

/** `.claude/settings.json` with generated permission rules appended where missing, and the main agent when given. */
export function mergeSettings(text: string | undefined, settings: GeneratedSettings, manifest: ForgeManifest): string {
  const path = '.claude/settings.json', current = parsed(path, text), permissions = section(path, current.permissions, 'permissions');
  if (settings.agent !== undefined && current.agent !== undefined && current.agent !== settings.agent && current.agent !== manifest.settings.agent) {
    throw conflict(`${path} already sets agent to ${JSON.stringify(current.agent)}, which Forge did not generate; remove it to let Forge set ${settings.agent}.`, { path, agent: current.agent });
  }
  const merged: Record<string, unknown> = { ...permissions };
  for (const list of ['allow', 'ask', 'deny'] as const) {
    const rules = settings.permissions[list];
    if (rules.length === 0) continue;
    const existing = permissions[list] === undefined ? [] : permissions[list];
    if (!Array.isArray(existing) || !existing.every(rule => typeof rule === 'string')) throw forgeError('INVALID_CLAUDE_SETTINGS', `${path} permissions.${list} must be an array of strings.`);
    merged[list] = [...existing, ...rules.filter(rule => !existing.includes(rule))];
  }
  return json({ ...current, ...(Object.keys(merged).length > 0 ? { permissions: merged } : {}), ...(settings.agent === undefined ? {} : { agent: settings.agent }) }, text);
}

/**
 * The next manifest: the entries Forge still owns (unchanged since it wrote them) and the ones this run writes.
 * `files` holds the current text of `.mcp.json` and `.claude/settings.json`.
 */
export function nextManifest(previous: ForgeManifest, text: string | undefined, files: { mcp?: string; settings?: string }, written: { servers: Record<string, unknown>; agent?: string }): string {
  const current = section('.mcp.json', parsed('.mcp.json', files.mcp).mcpServers, 'mcpServers');
  const kept = Object.fromEntries(Object.entries(previous.mcpServers).filter(([name, config]) => same(current[name], config)));
  const agent = written.agent ?? (parsed('.claude/settings.json', files.settings).agent === previous.settings.agent ? previous.settings.agent : undefined);
  return json({
    description: 'Entries The Forge wrote with agents generate. Forge replaces an entry of .mcp.json or .claude/settings.json only while it still has the content recorded here.',
    mcpServers: { ...kept, ...written.servers },
    settings: agent === undefined ? {} : { agent },
  }, text);
}
