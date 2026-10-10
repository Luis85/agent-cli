import { forgeError, ensure, isRecord } from '../shared/errors.ts';
import { jsonSchemaDialect, validateJsonValue, type JsonSchema } from '../schema/json-schema.ts';
import type { LiteralEdit } from './literal-edit.ts';
import { rangeEditModes, type RangeEditMode } from './sections.ts';
import type { TextEditRequest } from './text-edit.ts';

/** Plan and edit-list schema violations list at most this many issues. */
const reportedIssues = 20;

/** The `edit --edits` list and an `edit` operation's `edits`: ordered literal replacements. */
export const literalEditsSchema: JsonSchema = {
  type: 'array', minItems: 1, description: 'Literal replacements applied in order, each to the result of the previous one.',
  items: {
    type: 'object', additionalProperties: false, required: ['find', 'replace'],
    properties: {
      find: { type: 'string', minLength: 1, description: 'Exact text that must occur once, or at least once with all.' },
      replace: { type: 'string', description: 'Replacement text, inserted literally.' },
      all: { type: 'boolean', default: false, description: 'Replace every non-overlapping occurrence instead of exactly one.' },
    },
  },
};

const text = (description: string): JsonSchema => ({ type: 'string', description });
const path = (description = 'Path relative to the command scope.'): JsonSchema => ({ type: 'string', minLength: 1, description });
const ifMatch: JsonSchema = { type: 'string', minLength: 1, description: 'Revision the file (or folder) had before the plan ran, from read; a file keeps it across earlier moves in the plan.' };
const operation = (op: string, title: string, required: string[], properties: Record<string, JsonSchema>): JsonSchema => ({
  title, type: 'object', additionalProperties: false, required: ['op', ...required],
  properties: { op: { type: 'string', const: op }, ...properties, ifMatch },
});
const modeText: Record<RangeEditMode, string> = {
  replace: 'Replacement for the content (the heading line or block marker stays).',
  append: 'Lines to add after the content.',
  prepend: 'Lines to add before the content.',
};
const targets = {
  section: path('Heading path such as "Plan > Risks"; segments are separated by " > ".'),
  block: path('Block id, with or without the leading ^.'),
};
const editBranches: JsonSchema[] = [
  operation('edit', 'edit: literal replacements', ['path', 'edits'], { path: path(), edits: literalEditsSchema }),
  operation('edit', 'edit: append to the file', ['path', 'append'], { path: path(), append: text('Text appended to the end of the file.') }),
  ...(['section', 'block'] as const).flatMap(target => rangeEditModes.map(mode =>
    operation('edit', `edit: ${mode} in a ${target}`, ['path', target, mode], { path: path('Markdown note.'), [target]: targets[target], [mode]: text(modeText[mode]) }))),
];

/** JSON Schema 2020-12 of an `apply` plan; `help apply` and `schema` publish it with the plan argument. */
export const applyPlanSchema: JsonSchema = {
  $schema: jsonSchemaDialect, title: 'Forge apply plan', type: 'object', additionalProperties: false, required: ['version', 'operations'],
  description: 'Operations run in order against the planned state of the vault, then commit as one guarded batch.',
  properties: {
    version: { type: 'integer', const: 1 },
    operations: {
      type: 'array', minItems: 1,
      items: {
        oneOf: [
          operation('write', 'write: create or replace a file', ['path', 'content'], {
            path: path(), content: text('File content.'),
            encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8', description: 'base64 writes binary content.' },
          }),
          ...editBranches,
          operation('frontmatter', 'frontmatter: set and unset properties', ['path'], {
            path: path('Markdown note.'), set: { type: 'object', description: 'Properties to set; null stores YAML null.' },
            unset: { type: 'array', items: { type: 'string', minLength: 1 }, description: 'Property names to remove.' },
          }),
          operation('move', 'move: move or rename and rewrite links', ['from', 'to'], {
            from: path('File or folder to move.'), to: path('New path; it must not exist.'),
            updateLinks: { type: 'boolean', default: true, description: 'Rewrite links to the moved files.' },
          }),
          operation('delete', 'delete: move to .trash', ['path'], {
            path: path('File or folder to move to .trash.'),
            recursive: { type: 'boolean', default: false, description: 'Required to delete a folder.' },
            allowBrokenLinks: { type: 'boolean', default: false, description: 'Delete even while other files link to it.' },
          }),
        ],
      },
    },
  },
};

interface Guarded { ifMatch?: string }
export type WriteOperation = Guarded & { op: 'write'; path: string; content: string; encoding: 'utf8' | 'base64' };
export type EditOperation = Guarded & { op: 'edit'; path: string; edits?: LiteralEdit[]; append?: string; section?: string; block?: string; replace?: string; prepend?: string };
export type FrontmatterOperation = Guarded & { op: 'frontmatter'; path: string; set?: Record<string, unknown>; unset?: string[] };
export type MoveOperation = Guarded & { op: 'move'; from: string; to: string; updateLinks: boolean };
export type DeleteOperation = Guarded & { op: 'delete'; path: string; recursive: boolean; allowBrokenLinks: boolean };
export type PlanOperation = WriteOperation | EditOperation | FrontmatterOperation | MoveOperation | DeleteOperation;
export interface ApplyPlan { version: 1; operations: PlanOperation[] }

/**
 * Validates untrusted JSON against `schema`; violations fail with `code` and list `details.issues`, and the first
 * issue's array index (an operation of a plan, an edit of an edit list) is reported under `indexKey`.
 */
export function validated(schema: JsonSchema, value: unknown, at: string, failure: { what: string; indexKey: string; error: (message: string, details: Record<string, unknown>) => Error }): unknown {
  const result = validateJsonValue(schema, value, at);
  if (result.issues.length === 0) return result.value;
  const index = /^[^[:]*\[(\d+)\]/.exec(result.issues[0]!)?.[1];
  throw failure.error(`${failure.what} does not match its schema: ${result.issues.slice(0, 3).join('; ')}`, {
    issues: result.issues.slice(0, reportedIssues), ...(index === undefined ? {} : { [failure.indexKey]: Number(index) }),
  });
}

const operationIds = ['write', 'edit', 'frontmatter', 'move', 'delete'];

/** A validated plan; `details.operation` names the first invalid operation's 0-based index. */
export function parsePlan(value: unknown): ApplyPlan {
  // An unknown op matches no branch; name it instead of reporting the closest branch's discriminator.
  const operations: unknown[] = isRecord(value) && Array.isArray(value.operations) ? value.operations : [];
  operations.forEach((item, index) => {
    const issue = `plan.operations[${index}].op: must be one of ${operationIds.join(', ')}`;
    if (isRecord(item)) ensure(operationIds.includes(String(item.op)), 'INVALID_PLAN', `Operation ${index}: op must be one of ${operationIds.join(', ')}.`, { operation: index, issues: [issue] });
  });
  const plan = validated(applyPlanSchema, value, 'plan', { what: 'The plan', indexKey: 'operation', error: (message, details) => forgeError('INVALID_PLAN', message, details) }) as ApplyPlan;
  plan.operations.forEach((item, index) => {
    if (item.op === 'frontmatter') ensure(item.set !== undefined || item.unset !== undefined, 'INVALID_PLAN', `Operation ${index}: frontmatter needs set, unset or both.`, { operation: index });
  });
  return plan;
}

/** The text edit an `edit` operation describes; the schema guarantees exactly one shape. */
export function editRequest(item: EditOperation): TextEditRequest {
  if (item.edits !== undefined) return { kind: 'literal', edits: item.edits };
  const mode = rangeEditModes.find(candidate => item[candidate] !== undefined)!;
  if (item.section !== undefined) return { kind: 'section', section: item.section, mode, content: item[mode]! };
  if (item.block !== undefined) return { kind: 'block', block: item.block, mode, content: item[mode]! };
  return { kind: 'append', content: item.append! };
}
