import { type JsonSchema } from '../../domain/schema/json-schema.ts';
/** A plugin's own check of its schema-valid section; returns `<path>: <problem>` issues. */
export type SettingsCheck = (settings: Readonly<Record<string, unknown>>) => readonly string[];
/** One plugin's config section as `config` describes it. */
export interface SettingsSection {
    plugin: string;
    path: string;
    schema: JsonSchema;
}
/**
 * The outcome of validating `plugins.settings`: the effective sections (defaults filled for valid sections, invalid
 * and foreign sections unchanged), the issues of each invalid section by plugin id, and the loaded plugins that
 * have a section but declare no settings.
 */
export interface SettingsReport {
    effective: Record<string, unknown>;
    invalid: Map<string, string[]>;
    undeclared: string[];
}
/**
 * Plugin config sections under `plugins.settings.<id>`. Registered plugins declare a JSON Schema; `configure`
 * validates the workspace's sections against them, runs each plugin's own check and fills defaults. A section for a
 * plugin that is not loaded stays untouched, so disabling a plugin keeps its settings.
 */
export declare class PluginSettings {
    private readonly schemas;
    private readonly checks;
    private readonly values;
    private readonly frozen;
    declare(pluginId: string, schema: JsonSchema, check?: SettingsCheck): void;
    /** Validates every declared section; problems are reported per plugin rather than thrown. */
    configure(sections: Readonly<Record<string, unknown>>, loaded: ReadonlySet<string>): SettingsReport;
    /** The plugin's effective section as a frozen deep copy, so plugin code cannot change it; null without one. */
    value(pluginId: string): Readonly<Record<string, unknown>> | null;
    /** Canonical JSON of the effective section, which the settings revision hashes; null without a section. */
    canonical(pluginId: string): string | null;
    sections(): SettingsSection[];
}
