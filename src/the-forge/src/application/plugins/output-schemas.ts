import type { JsonSchema } from '../../domain/schema/json-schema.ts';

/**
 * Output schemas that mutating commands share, kernel and plugin commands alike: the guarded batch result
 * `{dryRun, changes}` that every workspace write returns. Objects stay open, so a command adds its own fields (the
 * created item, the selected project) beside these without breaking a validator.
 */
export const pathSchema: JsonSchema = { type: 'string', description: 'Path relative to context.root, with / separators.' };
export const revisionSchema: JsonSchema = { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'SHA-256 of the file bytes; pass it as --if-match.' };
export const dryRunSchema: JsonSchema = { type: 'boolean', description: 'True when --dry-run planned the changes without writing them.' };

/** One committed (or, in a dry run, planned) file change; a dry run adds the unified `diff`. */
const changeSchema: JsonSchema = {
  type: 'object', required: ['path', 'revision', 'operation', 'bytes'],
  properties: {
    path: pathSchema, revision: revisionSchema, operation: { type: 'string', enum: ['created', 'updated', 'deleted'] }, bytes: { type: 'integer', minimum: 0 },
    diff: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Dry runs only: a unified diff of the change, or null for binary content.' },
  },
};
export const changesSchema: JsonSchema = { type: 'array', items: changeSchema };

const previewSchema: JsonSchema = {
  type: 'array', description: 'Dry runs of generated files: the planned content of each file.',
  items: { type: 'object', required: ['path', 'content'], properties: { path: pathSchema, content: { type: 'string' } } },
};

/**
 * The result of a command that commits one guarded batch: `{dryRun, changes, preview?}`, plus the command's own
 * `properties`, of which `required` lists those every result has.
 */
export function changesOutput(properties: Readonly<Record<string, JsonSchema>> = {}, required: readonly string[] = []): JsonSchema {
  return {
    type: 'object', required: ['dryRun', 'changes', ...required],
    properties: { dryRun: dryRunSchema, changes: changesSchema, preview: previewSchema, ...properties },
  };
}
