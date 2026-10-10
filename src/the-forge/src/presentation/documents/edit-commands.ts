import { ensure, forgeError } from '../../domain/shared/errors.ts';
import { literalEditsSchema, applyPlanSchema, parsePlan, validated } from '../../domain/documents/apply-plan.ts';
import type { LiteralEdit } from '../../domain/documents/literal-edit.ts';
import type { TextEditRequest } from '../../domain/documents/text-edit.ts';
import { rangeEditModes } from '../../domain/documents/sections.ts';
import type { Command, CommandContext } from '../../application/plugins/registry.ts';
import { arity, integer, parseJson, value } from '../../application/plugins/command-input.ts';
import { option, type CommandFlags } from '../../application/plugins/command-metadata.ts';
import { decodeText, editBytes, ensureEditable } from '../../application/documents/text-edit.ts';
import { PlanRunner } from '../../application/documents/apply.ts';
import { applyOutput, editOutput } from './output.ts';

/** JSON text, `@path` (a file in the command scope) or `-` (standard input). */
async function jsonInput(source: string, context: Pick<CommandContext, 'workspace' | 'input'>): Promise<unknown> {
  if (source === '-') return parseJson(decodeText(await context.input()));
  if (source.startsWith('@')) return parseJson(decodeText((await context.workspace.files.read(source.slice(1))).bytes));
  return parseJson(source);
}

const modeUsage = '--replace text, --append --content text or --prepend --content text';

/** The text edit the options describe; contradictory or incomplete combinations are INVALID_INPUT. */
async function editRequest(flags: CommandFlags, context: CommandContext): Promise<TextEditRequest> {
  const section = value(flags, 'section'), block = value(flags, 'block'), edits = value(flags, 'edits');
  const find = value(flags, 'find'), replace = value(flags, 'replace'), content = value(flags, 'content');
  const modes = rangeEditModes.filter(mode => (mode === 'replace' ? replace !== undefined : flags[mode] === true));
  const line = integer(flags, 'section-line', 1);
  ensure(line === undefined || section !== undefined, 'INVALID_INPUT', '--section-line picks one of the headings a --section path matches; pass it with --section.');
  if (section !== undefined || block !== undefined) {
    ensure(section === undefined || block === undefined, 'INVALID_INPUT', 'Choose one of --section or --block.');
    ensure(find === undefined && edits === undefined, 'INVALID_INPUT', '--section and --block edit a part of the note; do not combine them with --find or --edits.');
    ensure(modes.length === 1, 'INVALID_INPUT', `With --section or --block, pass exactly one of ${modeUsage}.`);
    const mode = modes[0]!;
    ensure(mode === 'replace' ? content === undefined : content !== undefined, 'INVALID_INPUT', mode === 'replace' ? '--replace carries the new content; do not pass --content.' : `--${mode} needs --content.`);
    const text = mode === 'replace' ? replace! : content!;
    return section !== undefined ? { kind: 'section', section, ...(line === undefined ? {} : { line }), mode, content: text } : { kind: 'block', block: block!, mode, content: text };
  }
  ensure(flags.prepend !== true, 'INVALID_INPUT', '--prepend needs --section or --block.');
  if (edits !== undefined) {
    ensure(find === undefined && replace === undefined && flags.append !== true && content === undefined, 'INVALID_INPUT', '--edits carries every replacement; do not combine it with --find, --replace, --append or --content.');
    const list = validated(literalEditsSchema, await jsonInput(edits, context), 'edits', { what: '--edits', indexKey: 'edit', error: (message, details) => forgeError('INVALID_INPUT', message, details) });
    return { kind: 'literal', edits: list as LiteralEdit[] };
  }
  if (flags.append === true) {
    ensure(find === undefined && replace === undefined, 'INVALID_INPUT', 'Do not combine append and replace.');
    return { kind: 'append', content: value(flags, 'content', true)! };
  }
  ensure(content === undefined, 'INVALID_INPUT', '--content requires --append or --prepend.');
  return { kind: 'replace', find: value(flags, 'find', true)!, replace: value(flags, 'replace', true)! };
}

const editErrors = ['CONFLICT', 'NO_MATCH', 'AMBIGUOUS_EDIT', 'SECTION_NOT_FOUND', 'AMBIGUOUS_SECTION', 'UNSUPPORTED_EDIT', 'INVALID_INPUT', 'INVALID_JSON', 'INPUT_REQUIRED', 'INVALID_ENCODING', 'INVALID_FRONTMATTER', 'INVALID_YAML'];
const applyErrors = ['INVALID_PLAN', 'INVALID_JSON', 'INPUT_REQUIRED', 'NOT_FOUND', 'CONFLICT', 'DESTINATION_EXISTS', 'PROTECTED_PATH', 'INVALID_MOVE', 'HAS_BACKLINKS', ...editErrors.filter(code => !['CONFLICT', 'INVALID_JSON', 'INPUT_REQUIRED'].includes(code)), 'INVALID_KEY', 'INVALID_CANVAS', 'INVALID_BASE', 'ROLLBACK_FAILED'];

/** Precise edits of one file, and guarded multi-file plans. */
export function editCommand(): Command {
  return {
    id: 'edit', description: 'Edit Markdown or UTF-8 text in place: literal replacements, an append, or a section or block edit.',
    usage: 'edit <note.md|text-file> --if-match sha256 (--find text --replace text | --edits json|@file|- | --append --content text | (--section "A > B" [--section-line n] | --block id) (--replace text | --append --content text | --prepend --content text))',
    scope: 'project', discovery: false, mutating: true, args: [{ name: 'path', description: 'Vault path relative to the command scope.', required: true }], errors: editErrors, output: editOutput,
    options: {
      'if-match': option.string('SHA-256 revision the file must still have (from read).', { required: true }),
      find: option.string('Exact literal text that must occur once.'),
      replace: option.string('Replacement for the --find match, or the new content of the --section or --block.'),
      edits: option.string('JSON list of {find, replace, all?} applied in order, @file in the scope, or - for standard input.', { schema: literalEditsSchema }),
      append: option.boolean('Append --content to the end of the file, or after the --section or --block content.'),
      prepend: option.boolean('Insert --content before the --section or --block content.'),
      content: option.string('Text for --append or --prepend.'),
      section: option.string('Markdown heading path such as "Plan > Risks"; the section runs to the next heading of the same or a higher level. Write " > " inside a heading as " \\> ".'),
      'section-line': option.string('1-based line of the --section heading, from AMBIGUOUS_SECTION details.candidates, when the path matches several headings.'),
      block: option.string('Markdown block id (^id) of a paragraph, list item or section; a list item keeps its marker and checkbox, and content added next to it must be list items.'),
    },
    async run(args, flags, context) {
      arity(args, 1); const path = args[0]!;
      const request = await editRequest(flags, context);
      ensureEditable(path, request);
      return context.workspace.edit(path, value(flags, 'if-match', true)!, bytes => editBytes(path, bytes, request, context.metadata));
    },
  };
}

export function applyCommand(): Command {
  return {
    id: 'apply', description: 'Run a JSON plan of writes, edits, frontmatter changes, moves and deletions as one guarded batch.', usage: 'apply <plan.json|->',
    // Destructive: write, edit and delete replace or remove content. Not idempotent: an operation without ifMatch,
    // such as an append, applies again on a repeat; only a plan whose every operation carries ifMatch fails instead.
    scope: 'project', discovery: false, mutating: true, destructive: true, idempotent: false, errors: applyErrors, output: applyOutput,
    args: [{ name: 'plan', description: 'Plan file in the command scope, or - to read the plan from standard input.', required: true, schema: applyPlanSchema }],
    async run(args, _flags, context) {
      arity(args, 1);
      const plan = parsePlan(await jsonInput(args[0] === '-' ? '-' : `@${args[0]!}`, context));
      return new PlanRunner({ workspace: context.workspace, metadata: context.metadata, workspaceScope: context.project === null }).run(plan);
    },
  };
}
