import type { JsonSchema } from '../../../domain/schema/json-schema.ts';
import { propertyTypes } from '../domain/property-types.ts';
import { ruleIds, severities } from '../domain/rules.ts';

const text: JsonSchema = { type: 'string' };
const path: JsonSchema = { type: 'string', description: 'Path relative to context.root, with / separators.' };
const count: JsonSchema = { type: 'integer', minimum: 0 };
const position: JsonSchema = { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }], description: '1-based; null for a file-level finding.' };
const rule: JsonSchema = { type: 'string', enum: [...ruleIds] };
const severity: JsonSchema = { type: 'string', enum: [...severities] };
const propertyType: JsonSchema = { oneOf: [{ type: 'string', enum: [...propertyTypes] }, { type: 'null' }], description: 'null for an empty value.' };

const finding: JsonSchema = {
  type: 'object', required: ['rule', 'severity', 'path', 'line', 'column', 'message', 'hint'],
  properties: {
    rule, severity, path, line: position, column: position, message: text, hint: text,
    suggestion: { type: 'string', description: 'The closest existing file for a missing link or embed target.' },
  },
};

/** `vault check`: findings in path and line order, counts per severity and per rule, and the rules that did not run. */
const checkOutput: JsonSchema = {
  type: 'object', required: ['findings', 'summary', 'rules', 'skipped', 'strict'],
  properties: {
    findings: { type: 'array', items: finding },
    summary: {
      type: 'object', required: ['files', 'findings', ...severities],
      properties: { files: count, findings: count, ...Object.fromEntries(severities.map(level => [level, count])) },
    },
    rules: {
      type: 'array', description: 'The rules that ran, in reporting order, with their effective severity.',
      items: { type: 'object', required: ['id', 'severity', 'findings'], properties: { id: rule, severity, findings: count } },
    },
    skipped: {
      type: 'array', description: 'Selected rules that did not run: turned off in the settings, or their service is unavailable.',
      items: { type: 'object', required: ['rule', 'reason', 'message'], properties: { rule, reason: { type: 'string', enum: ['off', 'unavailable'] }, message: text } },
    },
    strict: { type: 'boolean' },
  },
};

/** `vault tags`: tags with the files that use them or a nested tag below them. */
const tagsOutput: JsonSchema = {
  type: 'object', required: ['tags'],
  properties: {
    tags: {
      type: 'array',
      items: { type: 'object', required: ['tag', 'count', 'files'], properties: { tag: { type: 'string', pattern: '^#' }, count, files: { type: 'array', items: path } } },
    },
  },
};

/** `vault properties`: property names with inferred, counted and declared types; `--name` adds each note's type. */
const propertiesOutput: JsonSchema = {
  type: 'object', required: ['properties', 'typesFile'],
  properties: {
    properties: {
      type: 'array',
      items: {
        type: 'object', required: ['name', 'count', 'empty', 'types', 'type', 'declared', 'conflicting'],
        properties: {
          name: text, count, empty: count,
          types: { type: 'object', properties: Object.fromEntries(propertyTypes.map(type => [type, count])) },
          type: propertyType, declared: { oneOf: [text, { type: 'null' }], description: 'The type .obsidian/types.json declares.' },
          conflicting: { type: 'boolean' },
          files: { type: 'array', items: { type: 'object', required: ['path', 'type'], properties: { path, type: propertyType } } },
        },
      },
    },
    typesFile: {
      type: 'object', required: ['path', 'status'],
      properties: { path, status: { type: 'string', enum: ['missing', 'loaded', 'invalid'] } },
    },
  },
};

/** The `data` of each `vault` action. */
export const vaultOutput = { check: checkOutput, tags: tagsOutput, properties: propertiesOutput } as const;
