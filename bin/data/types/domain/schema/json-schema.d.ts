/**
 * The JSON Schema 2020-12 subset Forge emits for command input and accepts for plugin settings. It covers what
 * command options, positional arguments and configuration sections need; unsupported keywords are rejected rather
 * than ignored, so a schema never promises validation it does not get. `contentMediaType` and `contentSchema` are
 * annotations by the specification: they describe the JSON document a string holds or names (`edit --edits`, the
 * `apply` plan) and are never validated here.
 */
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
export interface JsonSchema {
    $schema?: string;
    title?: string;
    description?: string;
    type?: JsonSchemaType;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean | JsonSchema;
    items?: JsonSchema;
    prefixItems?: JsonSchema[];
    minItems?: number;
    maxItems?: number;
    enum?: unknown[];
    const?: unknown;
    default?: unknown;
    /** Exactly one of these schemas must match; the matching one completes the value. */
    oneOf?: JsonSchema[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    contentMediaType?: string;
    contentSchema?: JsonSchema;
}
export declare const jsonSchemaDialect = "https://json-schema.org/draft/2020-12/schema";
/** Structural meta-check of the supported subset: each problem names the schema path. */
export declare function schemaIssues(schema: unknown, path?: string): string[];
/** Every `default` that its own schema rejects, as `<schema path>: <problem>`; run on schemas that passed `schemaIssues`. */
export declare function defaultIssues(schema: JsonSchema, path?: string): string[];
/**
 * Validates `value` against a schema that passed `schemaIssues`, filling `default`s of missing object properties.
 * Returns the completed copy and every issue as `<path>: <problem>`.
 */
export declare function validateJsonValue(schema: JsonSchema, value: unknown, path: string): {
    value: unknown;
    issues: string[];
};
