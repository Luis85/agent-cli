import { ensure, isRecord } from '../../domain/shared/errors.ts';
import { fileKind } from '../../domain/documents/file.ts';
import { base64Bytes } from '../../domain/documents/base64.ts';
import type { Command, CommandContext } from '../../application/plugins/registry.ts';
import { parseJson, readInputBytes, value } from '../../application/plugins/command-input.ts';
import { listOptionItems, option } from '../../application/plugins/command-metadata.ts';
import { encodeText } from '../cli/input.ts';
import { inputWarnings } from './input-warnings.ts';
import { applyCommand, editCommand } from './edit-commands.ts';
import { listCommand } from './list-command.ts';
import { readCommand } from './read-command.ts';
import { validateOutput } from './output.ts';
import { changesOutput } from '../../application/plugins/output-schemas.ts';

async function content(path: string, flags: Record<string, string | boolean>, context: CommandContext): Promise<Uint8Array> {
  const bytes = await readInputBytes(flags, context, 'Choose exactly one of --content, --from, or --stdin.');
  inputWarnings(path, flags, bytes, ['content'], context.workspace);
  const encoding = value(flags, 'encoding') ?? 'utf8';
  // Base64 is ASCII: the text decoder replaces other bytes, which the base64 check then refuses.
  return encoding === 'base64' ? base64Bytes(new TextDecoder().decode(bytes), 'Invalid base64 input.') : bytes;
}
const contentOptions = {
  content: option.string('Literal content.'),
  from: option.string('Copy the bytes of another file in the same scope.', { path: true }),
  stdin: option.boolean('Read the content from piped standard input.'),
  encoding: option.string('Decode --content, --from or --stdin input; base64 writes binary content.', { enum: ['utf8', 'base64'], default: 'utf8' }),
};
const ifMatch = (required = false) => option.string('SHA-256 revision the file must still have (from read).', { required });
const pathArgument = (description = 'Vault path relative to the command scope.') => ({ name: 'path', description, required: true, path: true });
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
      const file = await workspace.files.read(args[0]!); workspace.codec.validate(file.path, file.bytes);
      const kind = fileKind(file.path);
      return { path: file.path, valid: true, kind, validation: ['markdown', 'canvas', 'base'].includes(kind) ? 'structure' : kind === 'text' ? 'utf8' : 'opaque-bytes' };
    } },
    { id: 'create', description: 'Create a note, Canvas, Base, or file. Existing files are refused.', usage: 'create <path> [--content text | --from path | --stdin] [--encoding base64] [--project id]', ...writing, destructive: false, idempotent: true, args: [pathArgument('New vault path.')], options: { ...contentOptions, ...projectOptions }, output: changesOutput(),
      examples: ['create notes/idea.md --content "# Idea"', 'create notes/idea.md --stdin'],
      errors: ['CONFLICT', 'INVALID_INPUT', 'INVALID_ENCODING', 'INVALID_FRONTMATTER', 'INVALID_CANVAS', 'INVALID_BASE'], async run(args, flags, context) {
      const path = args[0]!;
      const hasInput = flags.content !== undefined || flags.from !== undefined || flags.stdin === true;
      const kind = fileKind(path);
      ensure(hasInput || flags.encoding === undefined, 'INVALID_INPUT', '--encoding requires an input source.');
      ensure(hasInput || defaultable.includes(kind), 'INVALID_INPUT', 'Attachments require content, from, or stdin.');
      const bytes = hasInput ? await content(path, flags, context) : defaultDocument(kind);
      return context.workspace.write([{ path, bytes }], { diff: true });
    } },
    // Idempotent although --if-match is optional: it is required once the file exists, so a repeat is refused with
    // CONFLICT, or writes the same bytes when the revision still matches.
    { id: 'write', description: 'Create or replace a file; replacement requires its current revision.', usage: 'write <path> (--content text | --from path | --stdin) [--encoding base64] [--if-match sha256] [--project id]', ...writing, idempotent: true, args: [pathArgument()], output: changesOutput(),
      examples: ['write notes/idea.md --from drafts/idea.md --if-match <revision>'],
      options: { ...contentOptions, 'if-match': ifMatch(), ...projectOptions }, errors: ['CONFLICT', 'INVALID_INPUT', 'INVALID_ENCODING', 'INVALID_FRONTMATTER', 'INVALID_CANVAS', 'INVALID_BASE'], async run(args, flags, context) {
      return context.workspace.write([{ path: args[0]!, bytes: await content(args[0]!, flags, context), expectedRevision: value(flags, 'if-match') }], { diff: true });
    } },
    editCommand(),
    { id: 'properties', description: 'Set or remove YAML frontmatter properties while preserving the Markdown body and untouched YAML.', usage: 'properties <note.md> (--set JSON | --unset key[,key] | both) --if-match sha256 [--project id]', ...writing, args: [pathArgument('Markdown note path.')], output: changesOutput(), errors: ['CONFLICT', 'UNSUPPORTED_EDIT', 'INVALID_JSON', 'INVALID_INPUT', 'INVALID_KEY', 'INVALID_FRONTMATTER', 'INVALID_YAML'],
      examples: ['properties notes/idea.md --set \'{"status":"done","tags":["plan"]}\' --if-match <revision>'],
      options: {
        set: option.string('JSON object of properties to set; null stores YAML null (use --unset to remove a key).'),
        unset: option.string('Comma-separated property names to remove.'),
        'if-match': ifMatch(true),
        ...projectOptions,
      }, async run(args, flags, { workspace }) {
      ensure(fileKind(args[0]!) === 'markdown', 'UNSUPPORTED_EDIT', 'Properties require a Markdown note.');
      const set = value(flags, 'set'), unset = value(flags, 'unset');
      ensure(set !== undefined || unset !== undefined, 'INVALID_INPUT', 'Pass --set, --unset or both.');
      const changes = set === undefined ? {} : parseJson(set); ensure(isRecord(changes), 'INVALID_INPUT', '--set must be a JSON object.');
      const removed = unset === undefined ? [] : listOptionItems(unset);
      ensure(removed.every(key => key.length > 0) && removed.every(key => !Object.hasOwn(changes, key)), 'INVALID_INPUT', '--unset lists nonempty property names that --set does not also set.');
      return workspace.edit(args[0]!, value(flags, 'if-match', true)!, bytes => workspace.codec.properties(bytes, changes, removed));
    } },
    { id: 'patch', description: 'Set a Canvas/Base JSON Pointer; - appends to an existing array.', usage: 'patch <path> --pointer /nodes/- --value JSON --if-match sha256 [--project id]', ...writing, args: [pathArgument('Canvas or Base path.')], output: changesOutput(), errors: ['CONFLICT', 'INVALID_POINTER', 'INVALID_JSON', 'INVALID_CANVAS', 'INVALID_BASE', 'UNSUPPORTED_EDIT'],
      options: { pointer: option.string('JSON Pointer to set; /- appends to an existing array.', { required: true }), value: option.string('JSON value to set.', { required: true }), 'if-match': ifMatch(true), ...projectOptions }, async run(args, flags, { workspace }) {
      const pointer = value(flags, 'pointer', true)!, data = parseJson(value(flags, 'value', true)!);
      return workspace.edit(args[0]!, value(flags, 'if-match', true)!, bytes => workspace.codec.patch(args[0]!, bytes, pointer, data));
    } },
    applyCommand(),
  ];
}
