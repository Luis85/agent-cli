import { fileKinds } from '../../domain/documents/file.ts';
import type { JsonSchema } from '../../domain/schema/json-schema.ts';

const text: JsonSchema = { type: 'string' };
const path: JsonSchema = { type: 'string', description: 'Path relative to context.root, with / separators.' };
const revision: JsonSchema = { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'SHA-256 of the file bytes; pass it as --if-match.' };
const kind = (...kinds: string[]): JsonSchema => kinds.length === 1 ? { type: 'string', const: kinds[0] } : { type: 'string', enum: kinds };
const attachmentKinds = fileKinds.filter(name => !['markdown', 'canvas', 'base', 'text'].includes(name));

/** `read`: the revision and byte count, and the parsed document by kind. */
export const readOutput: JsonSchema = {
  type: 'object', required: ['path', 'revision', 'bytes', 'document'],
  properties: {
    path, revision, bytes: { type: 'integer', minimum: 0 },
    document: { oneOf: [
      {
        title: 'markdown', type: 'object', required: ['kind', 'content', 'properties'],
        properties: { kind: kind('markdown'), content: text, properties: { type: 'object', description: 'Parsed YAML frontmatter.' }, body: { type: 'string', description: 'Text after the frontmatter, with --parts body.' } },
      },
      { title: 'canvas or base', type: 'object', required: ['kind', 'data'], properties: { kind: kind('canvas', 'base'), data: { type: 'object' } } },
      { title: 'text', type: 'object', required: ['kind', 'content'], properties: { kind: kind('text'), content: text } },
      {
        title: 'bytes', type: 'object', required: ['kind', 'encoding', 'content'],
        description: 'Attachments, and text-extension files that are not valid UTF-8, as base64.',
        properties: { kind: kind(...attachmentKinds), encoding: kind('base64'), content: text },
      },
    ] },
  },
};

/** `list`: one page of files in path order. */
export const listOutput: JsonSchema = {
  type: 'object', required: ['files'],
  properties: {
    files: { type: 'array', items: { type: 'object', required: ['path', 'kind'], properties: { path, kind: kind(...fileKinds) } } },
    nextCursor: { type: 'string', description: 'Present when the page was truncated; pass it as --cursor.' },
  },
};

/** `validate`: the structural check that passed. */
export const validateOutput: JsonSchema = {
  type: 'object', required: ['path', 'valid', 'kind', 'validation'],
  properties: { path, valid: { type: 'boolean', const: true }, kind: kind(...fileKinds), validation: kind('structure', 'utf8', 'opaque-bytes') },
};
