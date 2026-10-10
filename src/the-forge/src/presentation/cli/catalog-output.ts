import type { JsonSchema } from '../../domain/schema/json-schema.ts';

const text: JsonSchema = { type: 'string' };
const texts: JsonSchema = { type: 'array', items: text };
const flag: JsonSchema = { type: 'boolean' };
/** A JSON Schema document; its own validity is checked against the 2020-12 meta-schema, not here. */
const schemaDocument: JsonSchema = { type: 'object', description: 'A JSON Schema 2020-12 document.' };
const scope: JsonSchema = { type: 'string', enum: ['workspace', 'project'] };

const optionSchema: JsonSchema = {
  type: 'object', required: ['type', 'description'],
  properties: { type: { type: 'string', enum: ['string', 'boolean'] }, description: text, enum: texts, default: {}, required: flag },
};
const options: JsonSchema = { type: 'object', additionalProperties: optionSchema };
const argumentSchema: JsonSchema = {
  type: 'object', required: ['name', 'description'],
  properties: { name: text, description: text, required: flag, enum: texts, variadic: flag },
};
const hints: Record<string, JsonSchema> = {
  scope, discovery: flag, mutating: flag, readOnlyHint: flag, destructiveHint: flag, idempotentHint: flag,
};
const hintNames = ['scope', 'discovery', 'mutating', 'readOnlyHint', 'destructiveHint', 'idempotentHint'];
const annotations: JsonSchema = {
  type: 'object', required: hintNames,
  properties: {
    ...hints, defaultAction: text,
    actions: { type: 'object', additionalProperties: {
      type: 'object', required: ['description', ...hintNames],
      properties: { description: text, usage: text, ...hints, projectOption: text, options, outputSchema: schemaDocument },
    } },
  },
};

/** One command as `help <command>` describes it; `schema` adds `inputSchema`. */
const commandEntry: JsonSchema = {
  type: 'object', required: ['id', 'description', 'usage', 'options', 'args', 'annotations', 'errors', 'inputSchema'],
  properties: {
    id: text, description: text, usage: text, options, args: { type: 'array', items: argumentSchema }, annotations,
    errors: { ...texts, description: 'Codes the command reports itself, besides commonErrors.' },
    inputSchema: schemaDocument, outputSchema: schemaDocument,
  },
};
const errorEntry: JsonSchema = {
  type: 'object', required: ['code', 'exitCode', 'category', 'retryable', 'summary'],
  properties: { code: text, exitCode: { type: 'integer', minimum: 0 }, category: text, retryable: flag, summary: text, plugin: text },
};

/** The `schema` document: the full catalog, or one command's contract with only the error codes it can report. */
export const schemaOutput: JsonSchema = {
  type: 'object', required: ['name', 'version', 'apiVersion', 'dialect', 'globalOptions', 'envelope', 'commands', 'commonErrors', 'errors'],
  properties: {
    name: text, version: text, apiVersion: { type: 'integer', minimum: 1 }, node: text,
    dialect: { type: 'string', const: 'https://json-schema.org/draft/2020-12/schema' },
    globalOptions: options, envelope: schemaDocument, eventOutput: { type: 'object' },
    commands: { type: 'array', items: commandEntry },
    commonErrors: { ...texts, description: 'Input and runtime codes any command can report.' },
    generators: { type: 'array', items: { type: 'object', required: ['id', 'description'], properties: { id: text, description: text } } },
    skills: texts,
    errors: { type: 'array', items: errorEntry },
  },
};
