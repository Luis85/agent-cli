import { type JsonSchema } from '../../domain/schema/json-schema.ts';
/** One plugin's config section as `config` describes it. */
export interface SettingsSection {
    plugin: string;
    path: string;
    schema: JsonSchema;
}
/**
 * Plugin config sections under `plugins.settings.<id>`. Registered plugins declare a JSON Schema; `configure`
 * validates the workspace's sections against them and fills defaults. A section for a plugin that is not loaded
 * stays untouched, so disabling a plugin keeps its settings. A section for a loaded plugin without a schema is
 * rejected, which catches misspelled plugin ids.
 */
export declare class PluginSettings {
    private readonly schemas;
    private readonly values;
    declare(pluginId: string, schema: JsonSchema): void;
    /** Validates every declared section and returns the effective `plugins.settings` object. INVALID_CONFIG on failure. */
    configure(sections: Readonly<Record<string, unknown>>, loaded: ReadonlySet<string>): Record<string, unknown>;
    value(pluginId: string): Readonly<Record<string, unknown>> | null;
    /** Canonical JSON of the effective section, which the settings revision hashes; null without a section. */
    canonical(pluginId: string): string | null;
    sections(): SettingsSection[];
}
