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

/** One committed (or, in a dry run, planned) file change; a dry run adds the unified `diff`. */
const change: JsonSchema = {
  type: 'object', required: ['path', 'revision', 'operation', 'bytes'],
  properties: {
    path, revision, operation: kind('created', 'updated', 'deleted'), bytes: { type: 'integer', minimum: 0 },
    diff: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Dry runs only: a unified diff of the change, or null for binary content.' },
  },
};
const changes: JsonSchema = { type: 'array', items: change };
const dryRun: JsonSchema = { type: 'boolean', description: 'True when --dry-run planned the changes without writing them.' };

/** `edit`: the one guarded write. */
export const editOutput: JsonSchema = { type: 'object', required: ['dryRun', 'changes'], properties: { dryRun, changes } };

const count: JsonSchema = { type: 'integer', minimum: 0 };
const rename: JsonSchema = {
  type: 'object', required: ['from', 'to', 'kind'],
  properties: { from: path, to: path, kind: kind('file', 'folder'), revision, bytes: count },
};
const operationSummary: JsonSchema = {
  type: 'object', required: ['index', 'op', 'path'],
  description: 'What one operation did in the planned state: write adds operation, frontmatter adds changed, move adds to, kind and links, delete adds kind, trashPath (null when the plan created everything it deleted, so nothing reaches .trash) and brokenLinks.',
  properties: {
    index: { type: 'integer', minimum: 0, description: 'Position of the operation in the plan.' },
    op: kind('write', 'edit', 'frontmatter', 'move', 'delete'), path: { type: 'string', description: 'The operation path, or the source of a move.' },
    operation: kind('created', 'updated'), changed: { type: 'boolean' }, to: path, kind: kind('file', 'folder'),
    links: { type: 'object', required: ['updated', 'files', 'unrewritten'], properties: { updated: count, files: count, unrewritten: { type: 'array', description: 'Links the move could not rewrite.' } } },
    trashPath: { oneOf: [path, { type: 'null' }] }, brokenLinks: { type: 'array', description: 'Links into the deleted file that allowBrokenLinks left broken.' },
  },
};

/** `apply`: the operation summaries in plan order and the one batch they committed (or planned with --dry-run). */
export const applyOutput: JsonSchema = {
  type: 'object', required: ['dryRun', 'operations', 'renames', 'changes', 'folders'],
  properties: {
    dryRun, operations: { type: 'array', items: operationSummary },
    renames: { type: 'array', items: rename, description: 'Moves, including deletions into .trash, in commit order.' },
    changes, folders: { type: 'array', items: path, description: 'Folders the batch created.' },
  },
};
