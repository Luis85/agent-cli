import { isRecord } from '../../domain/shared/errors.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import { validateJsonValue, type JsonSchema } from '../../domain/schema/json-schema.ts';

/** A plugin's own check of its schema-valid section; returns `<path>: <problem>` issues. */
export type SettingsCheck = (settings: Readonly<Record<string, unknown>>) => readonly string[];
/**
 * How the host completes a plugin's schema-valid section: `paths` names top-level string settings that hold contained
 * relative folders, which the host normalizes and checks; `check` is the plugin's own check of the result.
 */
export interface SettingsDeclaration { paths?: readonly string[]; check?: SettingsCheck }
/** One plugin's config section as `config` describes it. */
export interface SettingsSection { plugin: string; path: string; schema: JsonSchema }
/**
 * The outcome of validating `plugins.settings`: the effective sections (defaults filled for valid sections, invalid
 * and foreign sections unchanged), the issues of each invalid section by plugin id, and the loaded plugins that
 * have a section but declare no settings.
 */
export interface SettingsReport { effective: Record<string, unknown>; invalid: Map<string, string[]>; undeclared: string[] }

/** A deep copy that can no longer change, for handing settings to plugin code. */
function frozenCopy<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (node: unknown) => {
    if (node === null || typeof node !== 'object') return;
    Object.freeze(node);
    for (const child of Object.values(node)) freeze(child);
  };
  freeze(copy);
  return copy;
}

/**
 * Plugin config sections under `plugins.settings.<id>`. Registered plugins declare a JSON Schema; `configure`
 * validates the workspace's sections against them, runs each plugin's own check and fills defaults. A section for a
 * plugin that is not loaded stays untouched, so disabling a plugin keeps its settings.
 */
export class PluginSettings {
  private readonly schemas = new Map<string, JsonSchema>();
  private readonly declarations = new Map<string, SettingsDeclaration>();
  private readonly values = new Map<string, Record<string, unknown>>();
  private readonly frozen = new Map<string, Readonly<Record<string, unknown>>>();

  declare(pluginId: string, schema: JsonSchema, declaration: SettingsDeclaration = {}): void {
    this.schemas.set(pluginId, schema);
    this.declarations.set(pluginId, declaration);
  }

  /**
   * Validates every declared section; problems are reported per plugin rather than thrown. Path settings are
   * normalized here, the one place every consumer reads from: `config`, the settings revision and `context.settings`.
   */
  configure(sections: Readonly<Record<string, unknown>>, loaded: ReadonlySet<string>): SettingsReport {
    const invalid = new Map<string, string[]>();
    const effective: Record<string, unknown> = { ...sections };
    const undeclared = Object.keys(sections).filter(pluginId => loaded.has(pluginId) && !this.schemas.has(pluginId)).sort();
    for (const [pluginId, schema] of this.schemas) {
      const result = this.complete(pluginId, schema, Object.hasOwn(sections, pluginId) ? sections[pluginId] : {});
      if (result.value === undefined) { invalid.set(pluginId, result.issues); continue; }
      this.values.set(pluginId, result.value);
      this.frozen.set(pluginId, frozenCopy(result.value));
      effective[pluginId] = result.value;
    }
    return { effective: Object.fromEntries(Object.keys(effective).sort().map(id => [id, effective[id]])), invalid, undeclared };
  }

  /** One section through the schema (filling defaults), path normalization and the plugin's own check. */
  private complete(pluginId: string, schema: JsonSchema, section: unknown): { value?: Record<string, unknown>; issues: string[] } {
    const result = validateJsonValue(schema, section, `plugins.settings.${pluginId}`);
    if (result.issues.length > 0 || !isRecord(result.value)) return { issues: result.issues };
    const { paths = [], check } = this.declarations.get(pluginId) ?? {};
    const value = normalizedPaths(result.value, paths);
    const issues = pathIssues(pluginId, value, paths);
    if (issues.length === 0) issues.push(...check?.(frozenCopy(value)) ?? []);
    return issues.length > 0 ? { issues } : { value, issues };
  }

  /** The plugin's effective section as a frozen deep copy, so plugin code cannot change it; null without one. */
  value(pluginId: string): Readonly<Record<string, unknown>> | null { return this.frozen.get(pluginId) ?? null; }

  /** Canonical JSON of the effective section, which the settings revision hashes; null without a section. */
  canonical(pluginId: string): string | null {
    const value = this.values.get(pluginId);
    return value === undefined ? null : canonicalJson(value);
  }

  sections(): SettingsSection[] {
    return [...this.schemas].map(([plugin, schema]) => ({ plugin, path: `plugins.settings.${plugin}`, schema }));
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** The section with each path setting's trailing slashes dropped, as `paths.*` in the kernel configuration. */
function normalizedPaths(section: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const normalized = { ...section };
  for (const key of keys) if (typeof normalized[key] === 'string') normalized[key] = normalized[key].replace(/\/+$/, '');
  return normalized;
}

/** Issues for path settings that are absolute, empty, traverse upward or contain empty segments. */
function pathIssues(pluginId: string, section: Readonly<Record<string, unknown>>, keys: readonly string[]): string[] {
  return keys.filter(key => section[key] !== undefined).flatMap(key => {
    try { vaultPath(String(section[key])); return []; }
    catch { return [`plugins.settings.${pluginId}.${key}: must be a contained workspace-relative path`]; }
  });
}
