import type { JsonSchema } from '../../../domain/schema/json-schema.ts';

const text: JsonSchema = { type: 'string' };
const position: JsonSchema = { type: 'integer', minimum: 1 };

/** One reference with its source location and resolution, as `LinkEntry` describes it. */
const linkEntry: JsonSchema = {
  type: 'object', required: ['source', 'kind', 'original', 'link', 'status'],
  properties: {
    source: text, kind: { type: 'string', enum: ['link', 'embed', 'frontmatter', 'canvas'] },
    line: position, column: position, offset: { type: 'integer', minimum: 0 },
    key: { type: 'string', description: 'The frontmatter property of a frontmatter link.' }, node: { type: 'string', description: 'The Canvas node id of a file node.' },
    original: text, link: text, displayText: text,
    status: { type: 'string', enum: ['resolved', 'unresolved', 'external'] },
    target: text, via: { type: 'string', enum: ['path', 'alias'] },
    reason: { type: 'string', enum: ['missing', 'ambiguous'] }, candidates: { type: 'array', items: text },
  },
};
const links: JsonSchema = { type: 'array', items: linkEntry };
const issues: JsonSchema = {
  type: 'array', description: 'Files the metadata cache could not parse.',
  items: { type: 'object', required: ['path', 'code', 'message'], properties: { path: text, code: text, message: text } },
};
const notes: JsonSchema = { type: 'object', required: ['files', 'issues'], properties: { files: { type: 'array', items: text }, issues } };

/** The `data` of each `links` action. */
export const linksOutput: Record<'out' | 'back' | 'unresolved' | 'orphans' | 'deadends', JsonSchema> = {
  out: { type: 'object', required: ['path', 'links', 'issues'], properties: { path: text, links, issues } },
  back: { type: 'object', required: ['path', 'backlinks', 'issues'], properties: { path: text, backlinks: links, issues } },
  unresolved: { type: 'object', required: ['links', 'issues'], properties: { links, issues } },
  orphans: notes,
  deadends: notes,
};
