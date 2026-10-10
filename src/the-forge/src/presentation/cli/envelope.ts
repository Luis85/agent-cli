import { jsonSchemaDialect, type JsonSchema } from '../../domain/schema/json-schema.ts';

const text: JsonSchema = { type: 'string' };

/** A managed project as `project` actions and the envelope's `context.project` report it. */
export const projectInfoSchema: JsonSchema = {
  type: 'object', required: ['schemaVersion', 'name', 'type', 'directory'],
  properties: {
    schemaVersion: { type: 'integer', const: 1 }, name: text, type: { type: 'string', enum: ['library'] },
    directory: { type: 'string', description: 'Workspace-relative project directory with / separators.' },
  },
};

/** The selected project, or `null` for workspace scope. */
export const selectedProjectSchema: JsonSchema = { oneOf: [{ type: 'null' }, projectInfoSchema] };

/** The executed scope of one invocation; absent from version output and from failures before scope resolution. */
const contextSchema: JsonSchema = {
  type: 'object', required: ['workspaceRoot', 'root', 'project'],
  description: 'The scope this invocation ran in: relative paths in data, changes and events resolve against root.',
  properties: {
    workspaceRoot: { type: 'string', description: 'Absolute workspace root.' },
    root: { type: 'string', description: 'Absolute root of this command: the selected project for project-scoped commands, else the workspace.' },
    project: { ...selectedProjectSchema, description: 'The project whose directory is root, or null at workspace scope.' },
  },
};

const errorSchema: JsonSchema = {
  type: 'object', required: ['code', 'message'],
  properties: {
    code: { type: 'string', pattern: '^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$', description: 'Stable code listed in schema data.errors.' },
    message: text,
    hint: { type: 'string', description: 'The next step to take.' },
    retryable: { type: 'boolean', description: 'Whether the unchanged invocation can succeed later.' },
    details: { type: 'object', description: 'Code-specific recovery details, such as currentRevision for CONFLICT.' },
  },
};

const common: Record<string, JsonSchema> = {
  context: contextSchema,
  events: {
    type: 'array', description: 'Event records selected by --events: committed vault.* records by default.',
    items: { type: 'object', required: ['id', 'payload'], properties: { id: text, payload: {} } },
  },
  warnings: { type: 'array', items: text, description: 'Nonfatal problems, such as failed event listeners after a committed write.' },
};

/**
 * JSON Schema 2020-12 of every response on stdout: success carries `data` (described per command by its output
 * schema), failure carries `error`; both carry `events`, `warnings` and, once the scope is resolved, `context`.
 */
export const envelopeSchema: JsonSchema = {
  $schema: jsonSchemaDialect, title: 'Forge response envelope',
  description: 'One JSON document per invocation. Check both ok and the process exit status.',
  type: 'object', required: ['ok', 'events', 'warnings'],
  oneOf: [
    {
      title: 'success', type: 'object', additionalProperties: false, required: ['ok', 'data', 'events', 'warnings'],
      properties: { ok: { type: 'boolean', const: true }, data: { description: 'The command result; see the command outputSchema.' }, ...common },
    },
    {
      title: 'failure', type: 'object', additionalProperties: false, required: ['ok', 'error', 'events', 'warnings'],
      properties: { ok: { type: 'boolean', const: false }, error: errorSchema, ...common },
    },
  ],
};
