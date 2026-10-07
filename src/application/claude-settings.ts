import { AppError, ensure, isRecord } from '../domain/errors.ts';
import { validateClaudeHooks } from '../domain/claude-hooks.ts';
import type { Workspace } from './workspace.ts';

const policyBooleans = ['disableAllHooks', 'allowManagedHooksOnly'];
const policyLists = ['allowedHttpHookUrls', 'httpHookAllowedEnvVars'];

function validateHookPolicy(settings: Record<string, unknown>): void {
  for (const key of policyBooleans) if (Object.hasOwn(settings, key)) {
    ensure(typeof settings[key] === 'boolean', 'INVALID_CLAUDE_SETTINGS', `${key} must be a boolean.`);
  }
  for (const key of policyLists) if (Object.hasOwn(settings, key)) {
    ensure(Array.isArray(settings[key]) && settings[key].every(entry => typeof entry === 'string'), 'INVALID_CLAUDE_SETTINGS', `${key} must be an array of strings.`);
  }
}

/** Own only the requested Claude settings keys; preserve every unrelated setting. */
export class ClaudeSettings {
  constructor(private readonly workspace: Workspace, private readonly path: string, private readonly plugin = false) {}

  async inspect() {
    try {
      const file = await this.workspace.files.read(this.path);
      let settings: unknown;
      try { settings = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)); }
      catch { throw new AppError('INVALID_CLAUDE_SETTINGS', `Expected UTF-8 JSON settings at ${this.path}.`, 2); }
      ensure(isRecord(settings), 'INVALID_CLAUDE_SETTINGS', 'Claude settings must be a JSON object.');
      return { path: this.path, revision: file.revision, settings, hooks: Object.hasOwn(settings, 'hooks') ? settings.hooks : {} };
    } catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') return { path: this.path, revision: null, settings: {} as Record<string, unknown>, hooks: {} };
      throw error;
    }
  }

  async validate() {
    const result = await this.inspect();
    validateClaudeHooks(result.hooks);
    validateHookPolicy(result.settings);
    return { ...result, hooks: result.hooks, valid: true, validation: 'configuration; hook code is not executed' };
  }

  async set(hooks: unknown, revision?: string) {
    validateClaudeHooks(hooks);
    const current = await this.inspect();
    return this.save({ ...current.settings, hooks }, current.revision, revision);
  }

  async add(event: string, group: unknown, revision?: string) {
    validateClaudeHooks({ [event]: [group] });
    const current = await this.validate();
    const hooks = current.hooks as Record<string, unknown[]>;
    return this.save({ ...current.settings, hooks: { ...hooks, [event]: [...(Object.hasOwn(hooks, event) ? hooks[event]! : []), group] } }, current.revision, revision);
  }

  async remove(event: string, revision: string, index?: number) {
    const current = await this.validate();
    const hooks = { ...current.hooks } as Record<string, unknown[]>;
    ensure(Object.hasOwn(hooks, event), 'NOT_FOUND', `No ${event} hooks configured in ${this.path}.`);
    if (index === undefined) delete hooks[event];
    else {
      ensure(Number.isSafeInteger(index) && index >= 0 && index < hooks[event]!.length, 'INVALID_ARGUMENT', 'Hook index must identify an existing matcher group.');
      hooks[event] = hooks[event]!.filter((_, position) => position !== index);
      if (!hooks[event]!.length) delete hooks[event];
    }
    return this.save({ ...current.settings, hooks }, current.revision, revision);
  }

  async toggle(enabled: boolean, revision?: string) {
    ensure(!this.plugin, 'INVALID_ARGUMENT', 'Plugin hooks are enabled or disabled with their installed plugin.');
    const current = await this.inspect();
    return this.save({ ...current.settings, disableAllHooks: !enabled }, current.revision, revision);
  }

  async configure(changes: unknown, revision?: string) {
    ensure(!this.plugin, 'INVALID_ARGUMENT', 'Hook policy belongs to project or user settings, not a plugin hooks file.');
    ensure(isRecord(changes), 'INVALID_CLAUDE_SETTINGS', 'Hook policy changes must be a JSON object.');
    for (const key of Object.keys(changes)) ensure(policyBooleans.includes(key) || policyLists.includes(key), 'INVALID_CLAUDE_SETTINGS', `Unsupported hook policy setting: ${key}.`);
    validateHookPolicy(changes);
    const current = await this.inspect();
    const next = { ...current.settings, ...changes };
    validateHookPolicy(next);
    return this.save(next, current.revision, revision);
  }

  async agentEnabled(name: string, enabled: boolean, revision?: string) {
    ensure(!this.plugin, 'INVALID_ARGUMENT', 'Agent permission rules belong to project or user settings, not a plugin hooks file.');
    const current = await this.inspect();
    const permissions = Object.hasOwn(current.settings, 'permissions') ? current.settings.permissions : {};
    ensure(isRecord(permissions), 'INVALID_CLAUDE_SETTINGS', 'permissions must be an object.');
    const deny = Object.hasOwn(permissions, 'deny') ? permissions.deny : [];
    ensure(Array.isArray(deny) && deny.every(item => typeof item === 'string'), 'INVALID_CLAUDE_SETTINGS', 'permissions.deny must be an array of strings.');
    // Names containing permission syntax cannot safely become a literal Agent rule.
    ensure(!/[()*]/.test(name), 'INVALID_CLAUDE_AGENT', 'This agent name cannot be represented as a literal Agent(name) permission rule.');
    const rule = `Agent(${name})`;
    const next = enabled ? deny.filter(item => item !== rule) : deny.includes(rule) ? deny : [...deny, rule];
    const result = await this.save({ ...current.settings, permissions: { ...permissions, deny: next } }, current.revision, revision);
    return { ...result, rule, enabled, note: 'Other permission rules and managed settings may still restrict this agent.' };
  }

  private async save(settings: Record<string, unknown>, actual: string | null, expected?: string) {
    ensure(actual === (expected ?? null), 'CONFLICT', `Inspect ${this.path} and supply its current --if-match revision before updating existing settings.`);
    const content = JSON.stringify(settings, null, 2) + '\n';
    const result = await this.workspace.write([{ path: this.path, bytes: new TextEncoder().encode(content), ...(expected ? { expectedRevision: expected } : {}) }]);
    return { path: this.path, ...result, ...(result.dryRun ? { preview: [{ path: this.path, content }] } : {}) };
  }
}
