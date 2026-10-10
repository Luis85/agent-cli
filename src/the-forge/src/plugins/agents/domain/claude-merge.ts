import { forgeError, isRecord } from '../../../domain/shared/errors.ts';

/**
 * Merges generated MCP servers and settings into the project's existing Claude files. Merges own only the keys they
 * generate: other servers, settings and permission rules stay as they are, in their order.
 */
function parsed(path: string, text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw forgeError('INVALID_CLAUDE_SETTINGS', `${path} is not valid JSON; fix it before generating into it.`); }
  if (!isRecord(value)) throw forgeError('INVALID_CLAUDE_SETTINGS', `${path} must contain a JSON object.`);
  return value;
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** `.mcp.json` with the generated servers set by name. */
export function mergeMcpServers(path: string, text: string | undefined, servers: Record<string, Record<string, unknown>>): string {
  const current = parsed(path, text);
  const existing = current.mcpServers === undefined ? {} : current.mcpServers;
  if (!isRecord(existing)) throw forgeError('INVALID_CLAUDE_SETTINGS', `${path} mcpServers must be an object.`);
  return json({ ...current, mcpServers: { ...existing, ...servers } });
}

/** `.claude/settings.json` with generated permission rules appended where missing, and the main agent when given. */
export function mergeSettings(path: string, text: string | undefined, settings: { permissions: Record<'allow' | 'ask' | 'deny', string[]>; agent?: string }): string {
  const current = parsed(path, text);
  const permissions = current.permissions === undefined ? {} : current.permissions;
  if (!isRecord(permissions)) throw forgeError('INVALID_CLAUDE_SETTINGS', `${path} permissions must be an object.`);
  const merged: Record<string, unknown> = { ...permissions };
  for (const list of ['allow', 'ask', 'deny'] as const) {
    const rules = settings.permissions[list];
    if (rules.length === 0) continue;
    const existing = permissions[list] === undefined ? [] : permissions[list];
    if (!Array.isArray(existing) || !existing.every(rule => typeof rule === 'string')) throw forgeError('INVALID_CLAUDE_SETTINGS', `${path} permissions.${list} must be an array of strings.`);
    merged[list] = [...existing, ...rules.filter(rule => !existing.includes(rule))];
  }
  return json({ ...current, ...(Object.keys(merged).length > 0 ? { permissions: merged } : {}), ...(settings.agent === undefined ? {} : { agent: settings.agent }) });
}
