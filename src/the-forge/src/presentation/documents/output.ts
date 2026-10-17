import { fileKinds } from '../../domain/documents/file.ts';
import type { JsonSchema } from '../../domain/schema/json-schema.ts';
import { changesSchema as changes, dryRunSchema as dryRun, pathSchema as path, revisionSchema as revision } from '../../application/plugins/output-schemas.ts';

const text: JsonSchema = { type: 'string' };
const kind = (...kinds: string[]): JsonSchema => kinds.length === 1 ? { type: 'string', const: kinds[0] } : { type: 'string', enum: kinds };
const attachmentKinds = fileKinds.filter(name => !['markdown', 'canvas', 'base', 'text'].includes(name));

const lineNumber: JsonSchema = { type: 'integer', minimum: 1 };
/** `read`: the revision and byte count, and the parsed document by kind; long text or attachment content is truncated. */
export const readOutput: JsonSchema = {
  type: 'object', required: ['path', 'revision', 'bytes', 'document'],
  properties: {
    path, revision, bytes: { type: 'integer', minimum: 0, description: 'Size of the whole file in bytes, also when the content is truncated.' },
    truncated: { type: 'boolean', const: true, description: 'Present when --max-bytes cut text or attachment content; a warning says how to read the rest.' },
    lines: {
      type: 'object', required: ['start', 'end', 'total'], description: 'The lines content holds, with --lines or when content was truncated.',
      properties: { start: lineNumber, end: { type: 'integer', minimum: 0 }, total: { type: 'integer', minimum: 0, description: 'Lines of the whole file.' } },
    },
    document: { oneOf: [
      {
        title: 'markdown', type: 'object', required: ['kind'], description: 'content and properties, or the parts --parts selects.',
        properties: {
          kind: kind('markdown'), content: text, properties: { oneOf: [{ type: 'object' }, { type: 'null' }], description: 'Parsed YAML frontmatter, or null when it does not parse (see issue).' },
          body: { type: 'string', description: 'Text after the frontmatter, with --parts body.' },
          issue: {
            type: 'object', required: ['code', 'message'], description: 'Why the frontmatter does not parse; fix it with edit or write, then validate.',
            properties: { code: kind('INVALID_YAML', 'INVALID_FRONTMATTER'), message: text },
          },
        },
      },
      { title: 'canvas or base', type: 'object', required: ['kind', 'data'], properties: { kind: kind('canvas', 'base'), data: { type: 'object' } } },
      { title: 'text', type: 'object', required: ['kind', 'content'], properties: { kind: kind('text'), content: text } },
      {
        title: 'bytes', type: 'object', required: ['kind', 'encoding', 'content'],
        description: 'Attachments, and text-extension, Markdown, Canvas and Base files that are not valid UTF-8 (or text files with NUL characters), as base64.',
        properties: { kind: kind(...attachmentKinds), encoding: kind('base64'), content: text },
      },
    ] },
  },
};

/** `list`: one page of files in path order. */
export const listOutput: JsonSchema = {
  type: 'object', required: ['files', 'total'],
  properties: {
    files: { type: 'array', items: { type: 'object', required: ['path', 'kind'], properties: { path, kind: kind(...fileKinds) } } },
    total: { type: 'integer', minimum: 0, description: 'Every file that passes the filters, across all pages.' },
    nextCursor: { type: 'string', description: 'Present when the page was truncated; pass it as --cursor.' },
  },
};

/** `validate`: the structural check that passed. */
export const validateOutput: JsonSchema = {
  type: 'object', required: ['path', 'valid', 'kind', 'validation'],
  properties: { path, valid: { type: 'boolean', const: true }, kind: kind(...fileKinds), validation: kind('structure', 'utf8', 'opaque-bytes') },
};

const count: JsonSchema = { type: 'integer', minimum: 0 };
const rename: JsonSchema = {
  type: 'object', required: ['from', 'to', 'kind'],
  properties: { from: path, to: path, kind: kind('file', 'folder'), revision, bytes: count },
};
const links: JsonSchema = {
  type: 'object', required: ['updated', 'files', 'unrewritten'],
  properties: { updated: count, files: count, unrewritten: { type: 'array', description: 'Links the move could not rewrite, each with a reason.' } },
};

/** `move` and `rename`: the moved path, every rename in commit order, the files whose links were rewritten. */
export const moveOutput: JsonSchema = {
  type: 'object', required: ['dryRun', 'from', 'to', 'kind', 'renames', 'changes', 'links'],
  properties: {
    dryRun, from: path, to: path, kind: kind('file', 'folder'), revision: { ...revision, description: 'The revision the move was guarded with.' },
    renames: { type: 'array', items: rename, description: 'The moved folder (if any) and each moved descendant, in commit order.' }, changes, links,
  },
};

/** `delete`: the deleted path, where it went, every deleted entry and the links left broken. */
export const deleteOutput: JsonSchema = {
  type: 'object', required: ['dryRun', 'path', 'kind', 'permanent', 'trashPath', 'deleted', 'brokenLinks'],
  properties: {
    dryRun, path, kind: kind('file', 'folder'), revision, permanent: { type: 'boolean' },
    trashPath: { oneOf: [path, { type: 'null' }], description: 'Where the deletion moved it in .trash, or null with --permanent.' },
    deleted: { type: 'array', items: { type: 'object', required: ['path', 'kind'], properties: { path, kind: kind('file', 'folder'), revision, bytes: count } } },
    brokenLinks: { type: 'array', description: 'Links into the deleted path that --allow-broken-links left broken.' },
  },
};
const operationSummary: JsonSchema = {
  type: 'object', required: ['index', 'op', 'path'],
  description: 'What one operation did in the planned state: write adds operation, frontmatter adds changed, move adds to, kind and links, delete adds kind, trashPath (null when the plan created everything it deleted, so nothing reaches .trash) and brokenLinks.',
  properties: {
    index: { type: 'integer', minimum: 0, description: 'Position of the operation in the plan.' },
    op: kind('write', 'edit', 'frontmatter', 'move', 'delete'), path: { type: 'string', description: 'The operation path, or the source of a move.' },
    operation: kind('created', 'updated'), changed: { type: 'boolean' }, to: path, kind: kind('file', 'folder'),
    links: { ...links, properties: { ...links.properties, unrewritten: { type: 'array', description: 'Links the move could not rewrite.' } } },
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
