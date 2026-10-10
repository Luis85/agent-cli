import { forgeError, ensure, isRecord } from '../../domain/shared/errors.ts';
import { fileKinds, fileKind } from '../../domain/documents/file.ts';
import { replaceUniqueLiteral } from '../../domain/documents/literal-edit.ts';
import { pathGlob } from '../../domain/documents/path-glob.ts';
import { Pager } from '../../domain/shared/paging.ts';
import type { Command, CommandContext } from '../../application/plugins/registry.ts';
import { arity, integer, parseJson, readInputBytes, value } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { encodeText } from '../cli/input.ts';

async function content(flags: Record<string, string | boolean>, context: CommandContext): Promise<Uint8Array> {
  const bytes = await readInputBytes(flags, context, 'Choose exactly one of --content, --from, or --stdin.');
  const encoding = value(flags, 'encoding') ?? 'utf8';
  ensure(['utf8', 'base64'].includes(encoding), 'INVALID_ENCODING', 'Use utf8 or base64. --from copies raw bytes by default.');
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
const reading = { scope: 'project', discovery: false, mutating: false } as const;
const writing = { scope: 'project', discovery: false, mutating: true } as const;
const readParts = ['body'];

/** Markdown reads return content and properties; optional parts are requested explicitly. */
function selectedParts(flags: Record<string, string | boolean>, kind: string): Set<string> {
  const requested = value(flags, 'parts');
  if (requested === undefined) return new Set();
  const parts = requested.split(',').map(part => part.trim());
  ensure(parts.every(part => readParts.includes(part)), 'INVALID_ARGUMENT', `--parts accepts a comma-separated list of: ${readParts.join(', ')}.`);
  ensure(kind === 'markdown', 'INVALID_ARGUMENT', '--parts body requires a Markdown file.');
  return new Set(parts);
}
function utf8Text(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw forgeError('INVALID_ENCODING', 'Edits require valid UTF-8 text; use write for binary content.'); }
}

function defaultDocument(kind: ReturnType<typeof fileKind>): Uint8Array {
  if (kind === 'canvas') return encodeText('{"nodes":[],"edges":[]}\n');
  if (kind === 'base') return encodeText('views:\n  - type: table\n    name: Table\n');
  return encodeText('');
}
const defaultable = ['markdown', 'canvas', 'base', 'text'];

export function documentCommands(): Command[] {
  return [
    { id: 'list', description: 'List regular files in stable path order; skip symlinks, Git and node_modules.', usage: 'list [--kind markdown|canvas|base|image|audio|video|pdf|text|attachment] [--path glob] [--limit count] [--cursor token]', ...reading,
      options: {
        kind: option.string('Only files of this kind.', { enum: fileKinds }),
        path: option.string('Only files whose root-relative path matches this glob (*, **, ?, [abc], {a,b}).'),
        limit: option.string('Maximum number of files; a truncated page returns nextCursor.'),
        cursor: option.string('Continue after the page that returned this nextCursor, with the same --kind and --path.'),
      }, async run(args, flags, { workspace }) {
      arity(args, 0); const kind = value(flags, 'kind'), glob = value(flags, 'path');
      ensure(kind === undefined || fileKinds.includes(kind), 'INVALID_ARGUMENT', `--kind must be one of: ${fileKinds.join(', ')}.`);
      const matches = glob === undefined ? () => true : pathGlob(glob);
      const pager = new Pager<string>({ limit: integer(flags, 'limit', 1), cursor: value(flags, 'cursor') }, { command: 'list', kind: kind ?? null, path: glob ?? null }, path => [path]);
      for (const path of await workspace.files.list()) if ((!kind || fileKind(path) === kind) && matches(path)) pager.offer(path);
      const nextCursor = pager.nextCursor();
      return { files: pager.items.map(path => ({ path, kind: fileKind(path) })), ...(nextCursor === undefined ? {} : { nextCursor }) };
    } },
    { id: 'read', description: 'Read a document, UTF-8 text or base64 attachment with its SHA-256 revision.', usage: 'read <path> [--parts body]', ...reading, args: [pathArgument()], errors: ['NOT_FOUND', 'INVALID_FRONTMATTER'],
      options: { parts: option.string('Comma-separated optional parts of a Markdown read.', { enum: readParts }) }, async run(args, flags, { workspace }) {
      arity(args, 1); const parts = selectedParts(flags, fileKind(args[0]!));
      const result = await workspace.read(args[0]!);
      if (!isRecord(result.document) || result.document.kind !== 'markdown' || parts.has('body')) return result;
      const { body: _body, ...document } = result.document;
      return { ...result, document };
    } },
    { id: 'validate', description: 'Validate Markdown frontmatter, Canvas graph, Base structure or UTF-8 text.', usage: 'validate <path>', ...reading, args: [pathArgument()], errors: ['NOT_FOUND', 'INVALID_FRONTMATTER', 'INVALID_YAML', 'INVALID_CANVAS', 'INVALID_BASE', 'INVALID_ENCODING'], async run(args, _, { workspace }) {
      arity(args, 1); const file = await workspace.files.read(args[0]!); workspace.codec.validate(file.path, file.bytes);
      const kind = fileKind(file.path);
      return { path: file.path, valid: true, kind, validation: ['markdown', 'canvas', 'base'].includes(kind) ? 'structure' : kind === 'text' ? 'utf8' : 'opaque-bytes' };
    } },
    { id: 'create', description: 'Create a note, Canvas, Base, or file. Existing files are refused.', usage: 'create <path> [--content text | --from path | --stdin] [--encoding base64]', ...writing, args: [pathArgument('New vault path.')], options: contentOptions,
      errors: ['CONFLICT', 'INVALID_INPUT', 'INVALID_ENCODING', 'INVALID_FRONTMATTER', 'INVALID_CANVAS', 'INVALID_BASE'], async run(args, flags, context) {
      arity(args, 1); const path = args[0]!;
      const hasInput = flags.content !== undefined || flags.from !== undefined || flags.stdin === true;
      const kind = fileKind(path);
      ensure(hasInput || flags.encoding === undefined, 'INVALID_INPUT', '--encoding requires an input source.');
      ensure(hasInput || defaultable.includes(kind), 'INVALID_INPUT', 'Attachments require content, from, or stdin.');
      const bytes = hasInput ? await content(flags, context) : defaultDocument(kind);
      return context.workspace.write([{ path, bytes }], { diff: true });
    } },
    { id: 'write', description: 'Create or replace a file; replacement requires its current revision.', usage: 'write <path> (--content text | --from path | --stdin) [--encoding base64] [--if-match sha256]', ...writing, args: [pathArgument()],
      options: { ...contentOptions, 'if-match': ifMatch() }, errors: ['CONFLICT', 'INVALID_INPUT', 'INVALID_ENCODING', 'INVALID_FRONTMATTER', 'INVALID_CANVAS', 'INVALID_BASE'], async run(args, flags, context) {
      arity(args, 1); return context.workspace.write([{ path: args[0]!, bytes: await content(flags, context), expectedRevision: value(flags, 'if-match') }], { diff: true });
    } },
    { id: 'edit', description: 'Append to Markdown or UTF-8 text, or replace exactly one literal match.', usage: 'edit <note.md|text-file> --if-match sha256 (--append --content text | --find text --replace text)', ...writing, args: [pathArgument()], errors: ['CONFLICT', 'NO_MATCH', 'AMBIGUOUS_EDIT', 'UNSUPPORTED_EDIT', 'INVALID_INPUT', 'INVALID_ENCODING'],
      options: { 'if-match': ifMatch(true), append: option.boolean('Append --content to the end of the file.'), content: option.string('Text to append with --append.'), find: option.string('Exact literal text that must occur once.'), replace: option.string('Replacement for the --find match.') }, async run(args, flags, { workspace }) {
      arity(args, 1); const path = args[0]!;
      ensure(['markdown', 'text'].includes(fileKind(path)), 'UNSUPPORTED_EDIT', 'Use edit for Markdown and text files, patch for Canvas/Bases, and write for attachments.');
      const revision = value(flags, 'if-match', true)!;
      return workspace.edit(path, revision, bytes => {
        const text = utf8Text(bytes);
        if (flags.append) { ensure(flags.find === undefined && flags.replace === undefined, 'INVALID_INPUT', 'Do not combine append and replace.'); return encodeText(text + value(flags, 'content', true)!); }
        ensure(flags.content === undefined, 'INVALID_INPUT', '--content requires --append.');
        return encodeText(replaceUniqueLiteral(text, value(flags, 'find', true)!, value(flags, 'replace', true)!));
      });
    } },
    { id: 'properties', description: 'Merge YAML frontmatter properties while preserving the Markdown body.', usage: 'properties <note.md> --set JSON --if-match sha256', ...writing, args: [pathArgument('Markdown note path.')], errors: ['CONFLICT', 'UNSUPPORTED_EDIT', 'INVALID_JSON', 'INVALID_INPUT', 'INVALID_KEY', 'INVALID_FRONTMATTER'],
      options: { set: option.string('JSON object of properties to set.', { required: true }), 'if-match': ifMatch(true) }, async run(args, flags, { workspace }) {
      arity(args, 1); ensure(fileKind(args[0]!) === 'markdown', 'UNSUPPORTED_EDIT', 'Properties require a Markdown note.');
      const changes = parseJson(value(flags, 'set', true)!); ensure(isRecord(changes), 'INVALID_INPUT', '--set must be a JSON object.');
      return workspace.edit(args[0]!, value(flags, 'if-match', true)!, bytes => workspace.codec.properties(bytes, changes));
    } },
    { id: 'patch', description: 'Set a Canvas/Base JSON Pointer; - appends to an existing array.', usage: 'patch <path> --pointer /nodes/- --value JSON --if-match sha256', ...writing, args: [pathArgument('Canvas or Base path.')], errors: ['CONFLICT', 'INVALID_POINTER', 'INVALID_JSON', 'INVALID_CANVAS', 'INVALID_BASE', 'UNSUPPORTED_EDIT'],
      options: { pointer: option.string('JSON Pointer to set; /- appends to an existing array.', { required: true }), value: option.string('JSON value to set.', { required: true }), 'if-match': ifMatch(true) }, async run(args, flags, { workspace }) {
      arity(args, 1); const pointer = value(flags, 'pointer', true)!, data = parseJson(value(flags, 'value', true)!);
      return workspace.edit(args[0]!, value(flags, 'if-match', true)!, bytes => workspace.codec.patch(args[0]!, bytes, pointer, data));
    } },
  ];
}
