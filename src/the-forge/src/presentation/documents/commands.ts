import { ensure, isRecord } from '../../domain/shared/errors.ts';
import { fileKind } from '../../domain/documents/file.ts';
import type { Command, CommandContext } from '../../application/plugins/registry.ts';
import { arity, parseJson, readInputBytes, value } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { encodeText } from '../cli/input.ts';
import { applyCommand, editCommand } from './edit-commands.ts';
import { listCommand } from './list-command.ts';
import { readCommand } from './read-command.ts';
import { validateOutput } from './output.ts';

async function content(flags: Record<string, string | boolean>, context: CommandContext): Promise<Uint8Array> {
  const bytes = await readInputBytes(flags, context, 'Choose exactly one of --content, --from, or --stdin.');
  const encoding = value(flags, 'encoding') ?? 'utf8';
  if (encoding === 'base64') {
    const text = Buffer.from(bytes).toString('utf8').trim();
    ensure(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text), 'INVALID_ENCODING', 'Invalid base64 input.');
    return Buffer.from(text, 'base64');
  }
  return bytes;
}
const contentOptions = {
  content: option.string('Literal content.'),
  from: option.string('Copy the bytes of another file in the same scope.'),
  stdin: option.boolean('Read the content from piped standard input.'),
  encoding: option.string('Decode --content, --from or --stdin input; base64 writes binary content.', { enum: ['utf8', 'base64'], default: 'utf8' }),
};
const ifMatch = (required = false) => option.string('SHA-256 revision the file must still have (from read).', { required });
const pathArgument = (description = 'Vault path relative to the command scope.') => ({ name: 'path', description, required: true });
const reading = { scope: 'project', projectOption: 'project', discovery: false, mutating: false } as const;
const writing = { scope: 'project', projectOption: 'project', discovery: false, mutating: true } as const;
const projectOptions = { project: option.string('Use this project instead of the selected project.') };
function defaultDocument(kind: ReturnType<typeof fileKind>): Uint8Array {
  if (kind === 'canvas') return encodeText('{"nodes":[],"edges":[]}\n');
  if (kind === 'base') return encodeText('views:\n  - type: table\n    name: Table\n');
  return encodeText('');
}
const defaultable = ['markdown', 'canvas', 'base', 'text'];

export function documentCommands(): Command[] {
  return [
    listCommand(),
    readCommand(),
    { id: 'validate', description: 'Validate Markdown frontmatter, Canvas graph, Base structure or UTF-8 text.', usage: 'validate <path> [--project id]', ...reading, args: [pathArgument()], options: projectOptions, errors: ['NOT_FOUND', 'INVALID_FRONTMATTER', 'INVALID_YAML', 'INVALID_CANVAS', 'INVALID_BASE', 'INVALID_ENCODING'], output: validateOutput, async run(args, _, { workspace }) {
      arity(args, 1); const file = await workspace.files.read(args[0]!); workspace.codec.validate(file.path, file.bytes);
      const kind = fileKind(file.path);
      return { path: file.path, valid: true, kind, validation: ['markdown', 'canvas', 'base'].includes(kind) ? 'structure' : kind === 'text' ? 'utf8' : 'opaque-bytes' };
    } },
    { id: 'create', description: 'Create a note, Canvas, Base, or file. Existing files are refused.', usage: 'create <path> [--content text | --from path | --stdin] [--encoding base64] [--project id]', ...writing, destructive: false, idempotent: true, args: [pathArgument('New vault path.')], options: { ...contentOptions, ...projectOptions },
      errors: ['CONFLICT', 'INVALID_INPUT', 'INVALID_ENCODING', 'INVALID_FRONTMATTER', 'INVALID_CANVAS', 'INVALID_BASE'], async run(args, flags, context) {
      arity(args, 1); const path = args[0]!;
      const hasInput = flags.content !== undefined || flags.from !== undefined || flags.stdin === true;
      const kind = fileKind(path);
      ensure(hasInput || flags.encoding === undefined, 'INVALID_INPUT', '--encoding requires an input source.');
      ensure(hasInput || defaultable.includes(kind), 'INVALID_INPUT', 'Attachments require content, from, or stdin.');
      const bytes = hasInput ? await content(flags, context) : defaultDocument(kind);
      return context.workspace.write([{ path, bytes }], { diff: true });
    } },
    // Idempotent although --if-match is optional: it is required once the file exists, so a repeat is refused with
    // CONFLICT, or writes the same bytes when the revision still matches.
    { id: 'write', description: 'Create or replace a file; replacement requires its current revision.', usage: 'write <path> (--content text | --from path | --stdin) [--encoding base64] [--if-match sha256] [--project id]', ...writing, idempotent: true, args: [pathArgument()],
      options: { ...contentOptions, 'if-match': ifMatch(), ...projectOptions }, errors: ['CONFLICT', 'INVALID_INPUT', 'INVALID_ENCODING', 'INVALID_FRONTMATTER', 'INVALID_CANVAS', 'INVALID_BASE'], async run(args, flags, context) {
      arity(args, 1); return context.workspace.write([{ path: args[0]!, bytes: await content(flags, context), expectedRevision: value(flags, 'if-match') }], { diff: true });
    } },
    editCommand(),
    { id: 'properties', description: 'Merge YAML frontmatter properties while preserving the Markdown body.', usage: 'properties <note.md> --set JSON --if-match sha256 [--project id]', ...writing, args: [pathArgument('Markdown note path.')], errors: ['CONFLICT', 'UNSUPPORTED_EDIT', 'INVALID_JSON', 'INVALID_INPUT', 'INVALID_KEY', 'INVALID_FRONTMATTER'],
      options: { set: option.string('JSON object of properties to set.', { required: true }), 'if-match': ifMatch(true), ...projectOptions }, async run(args, flags, { workspace }) {
      arity(args, 1); ensure(fileKind(args[0]!) === 'markdown', 'UNSUPPORTED_EDIT', 'Properties require a Markdown note.');
      const changes = parseJson(value(flags, 'set', true)!); ensure(isRecord(changes), 'INVALID_INPUT', '--set must be a JSON object.');
      return workspace.edit(args[0]!, value(flags, 'if-match', true)!, bytes => workspace.codec.properties(bytes, changes));
    } },
    { id: 'patch', description: 'Set a Canvas/Base JSON Pointer; - appends to an existing array.', usage: 'patch <path> --pointer /nodes/- --value JSON --if-match sha256 [--project id]', ...writing, args: [pathArgument('Canvas or Base path.')], errors: ['CONFLICT', 'INVALID_POINTER', 'INVALID_JSON', 'INVALID_CANVAS', 'INVALID_BASE', 'UNSUPPORTED_EDIT'],
      options: { pointer: option.string('JSON Pointer to set; /- appends to an existing array.', { required: true }), value: option.string('JSON value to set.', { required: true }), 'if-match': ifMatch(true), ...projectOptions }, async run(args, flags, { workspace }) {
      arity(args, 1); const pointer = value(flags, 'pointer', true)!, data = parseJson(value(flags, 'value', true)!);
      return workspace.edit(args[0]!, value(flags, 'if-match', true)!, bytes => workspace.codec.patch(args[0]!, bytes, pointer, data));
    } },
    applyCommand(),
  ];
}
