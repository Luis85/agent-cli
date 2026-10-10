import { forgeError, isRecord } from '../../domain/shared/errors.ts';
import { validateJsonValue, type JsonSchema } from '../../domain/schema/json-schema.ts';

/** One plugin's config section as `config` describes it. */
export interface SettingsSection { plugin: string; path: string; schema: JsonSchema }

/**
 * Plugin config sections under `plugins.settings.<id>`. Registered plugins declare a JSON Schema; `configure`
 * validates the workspace's sections against them and fills defaults. A section for a plugin that is not loaded
 * stays untouched, so disabling a plugin keeps its settings. A section for a loaded plugin without a schema is
 * rejected, which catches misspelled plugin ids.
 */
export class PluginSettings {
  private readonly schemas = new Map<string, JsonSchema>();
  private readonly values = new Map<string, Record<string, unknown>>();

  declare(pluginId: string, schema: JsonSchema): void { this.schemas.set(pluginId, schema); }

  /** Validates every declared section and returns the effective `plugins.settings` object. INVALID_CONFIG on failure. */
  configure(sections: Readonly<Record<string, unknown>>, loaded: ReadonlySet<string>): Record<string, unknown> {
    const issues: string[] = [];
    const effective: Record<string, unknown> = { ...sections };
    for (const pluginId of Object.keys(sections)) {
      if (loaded.has(pluginId) && !this.schemas.has(pluginId)) issues.push(`plugins.settings.${pluginId}: plugin ${pluginId} declares no settings`);
    }
    for (const [pluginId, schema] of this.schemas) {
      const result = validateJsonValue(schema, Object.hasOwn(sections, pluginId) ? sections[pluginId] : {}, `plugins.settings.${pluginId}`);
      issues.push(...result.issues);
      if (result.issues.length === 0 && isRecord(result.value)) {
        this.values.set(pluginId, result.value);
        effective[pluginId] = result.value;
      }
    }
    if (issues.length > 0) throw forgeError('INVALID_CONFIG', issues.join('; '), { issues });
    return Object.fromEntries(Object.keys(effective).sort().map(id => [id, effective[id]]));
  }

  value(pluginId: string): Readonly<Record<string, unknown>> | null { return this.values.get(pluginId) ?? null; }

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
