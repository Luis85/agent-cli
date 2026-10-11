import { forgeError, isRecord } from '../../../domain/shared/errors.ts';
import { agentError } from './errors.ts';

/**
 * Merges generated MCP servers and settings into the project's existing Claude files. Forge owns only the entries it
 * wrote, recorded with their content in the manifest `.claude/forge-generated.json`: it replaces an entry only while
 * the entry still has the recorded content, and never replaces another entry of the same name. Permission rules are
 * recorded when Forge adds them, so a later generation removes the ones a definition no longer grants; a rule that
 * was already present stays the user's. Every other server, setting and rule stays as it is, in its order, and the
 * files keep their indentation and line endings.
 */
export const manifestPath = '.claude/forge-generated.json';

const permissionLists = ['allow', 'ask', 'deny'] as const;
type PermissionList = typeof permissionLists[number];
/** Permission rules by list; a list Forge holds no rule in is absent. */
export type PermissionRules = Partial<Record<PermissionList, string[]>>;
/** Entries of `.mcp.json` and `.claude/settings.json` that Forge wrote, with the content it wrote. */
export interface ForgeManifest { mcpServers: Record<string, unknown>; settings: { agent?: string; permissions?: PermissionRules } }
/** The other entries Forge must not replace: MCP servers by name and the settings' main agent. */
export interface ForeignEntries { servers: Record<string, unknown>; agent?: string }
export interface GeneratedSettings { permissions: Record<PermissionList, string[]>; agent?: string }
/** Merged settings text and the permission rules Forge now owns in it. */
export interface MergedSettings { text: string; owned: PermissionRules }

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

/** Rule lists of a `permissions` object; anything but arrays of strings is INVALID_CLAUDE_SETTINGS. */
function ruleLists(path: string, value: unknown): PermissionRules {
  const permissions = section(path, value, 'permissions'), rules: PermissionRules = {};
  for (const list of permissionLists) {
    const entries = permissions[list];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || !entries.every(rule => typeof rule === 'string')) throw forgeError('INVALID_CLAUDE_SETTINGS', `${path} permissions.${list} must be an array of strings.`);
    rules[list] = entries;
  }
  return rules;
}

/** Only the non-empty lists, so a manifest without owned rules records no permissions. */
const nonEmpty = (rules: PermissionRules): PermissionRules => Object.fromEntries(Object.entries(rules).filter(([, entries]) => entries.length > 0));

export function parseManifest(text: string | undefined): ForgeManifest {
  const value = parsed(manifestPath, text);
  const settings = section(manifestPath, value.settings, 'settings');
  const permissions = nonEmpty(ruleLists(`${manifestPath} settings`, settings.permissions));
  return {
    mcpServers: section(manifestPath, value.mcpServers, 'mcpServers'),
    settings: { ...(typeof settings.agent === 'string' ? { agent: settings.agent } : {}), ...(Object.keys(permissions).length > 0 ? { permissions } : {}) },
  };
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

/**
 * `.claude/settings.json` with the generated permission rules appended where missing, the rules Forge added earlier
 * that the definitions no longer grant removed, and the main agent when given. A list or `permissions` object that
 * held only removed rules is dropped. The result names the rules Forge owns afterwards: those it added now or
 * before, never a rule that was already present.
 */
export function mergeSettings(text: string | undefined, settings: GeneratedSettings, manifest: ForgeManifest): MergedSettings {
  const path = '.claude/settings.json', current = parsed(path, text), permissions = section(path, current.permissions, 'permissions');
  if (settings.agent !== undefined && current.agent !== undefined && current.agent !== settings.agent && current.agent !== manifest.settings.agent) {
    throw conflict(`${path} already sets agent to ${JSON.stringify(current.agent)}, which Forge did not generate; remove it to let Forge set ${settings.agent}.`, { path, agent: current.agent });
  }
  const existing = ruleLists(path, permissions), previous = manifest.settings.permissions ?? {};
  const merged: Record<string, unknown> = { ...permissions }, owned: PermissionRules = {};
  let removed = false;
  for (const list of permissionLists) {
    const granted = settings.permissions[list], before = existing[list] ?? [], mine = previous[list] ?? [];
    const kept = before.filter(rule => granted.includes(rule) || !mine.includes(rule));
    removed ||= kept.length < before.length;
    const rules = [...kept, ...granted.filter(rule => !kept.includes(rule))];
    owned[list] = granted.filter(rule => mine.includes(rule) || !before.includes(rule));
    if (rules.length > 0) merged[list] = rules;
    else delete merged[list];
  }
  // The permissions object keeps its position; one that held only removed rules is dropped.
  const next: Record<string, unknown> = { ...current, permissions: merged, ...(settings.agent === undefined ? {} : { agent: settings.agent }) };
  if (Object.keys(merged).length === 0 && (current.permissions === undefined || removed)) delete next.permissions;
  return { text: json(next, text), owned: nonEmpty(owned) };
}

/**
 * The next manifest: the entries Forge still owns (unchanged since it wrote them) and the ones this run writes.
 * `files` holds the current text of `.mcp.json` and `.claude/settings.json`.
 */
export function nextManifest(previous: ForgeManifest, text: string | undefined, files: { mcp?: string; settings?: string }, written: { servers: Record<string, unknown>; agent?: string; permissions?: PermissionRules }): string {
  const current = section('.mcp.json', parsed('.mcp.json', files.mcp).mcpServers, 'mcpServers');
  const kept = Object.fromEntries(Object.entries(previous.mcpServers).filter(([name, config]) => same(current[name], config)));
  const settings = parsed('.claude/settings.json', files.settings);
  const agent = written.agent ?? (settings.agent === previous.settings.agent ? previous.settings.agent : undefined);
  // Without a settings merge in this run, Forge keeps owning the recorded rules the settings file still holds.
  const present = ruleLists('.claude/settings.json', settings.permissions);
  const permissions = written.permissions ?? nonEmpty(Object.fromEntries(Object.entries(previous.settings.permissions ?? {})
    .map(([list, rules]) => [list, rules.filter(rule => present[list as PermissionList]?.includes(rule))])));
  return json({
    description: 'Entries The Forge wrote with agents generate. Forge replaces an entry of .mcp.json or .claude/settings.json only while it still has the content recorded here, and removes a recorded permission rule once no definition grants it.',
    mcpServers: { ...kept, ...written.servers },
    settings: { ...(agent === undefined ? {} : { agent }), ...(Object.keys(permissions).length > 0 ? { permissions } : {}) },
  }, text);
}
