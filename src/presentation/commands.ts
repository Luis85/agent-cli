import metadata from '../../package.json';
import { ensure, isRecord } from '../domain/errors.ts';
import { nativeFormats, fileKind } from '../domain/file.ts';
import { encodeText, encodeYaml } from '../infrastructure/documents.ts';
import type { Command, CommandContext, Registry } from '../application/plugins.ts';
import { arity, globalOptions, value } from './arguments.ts';
import { workflowCommands, makeDocument, parseJson, type WorkflowServices } from './workflow-commands.ts';

async function content(flags: Record<string, string | boolean>, context: CommandContext): Promise<Uint8Array> {
  const inline = value(flags, 'content'), from = value(flags, 'from');
  ensure([inline !== undefined, from !== undefined, flags.stdin === true].filter(Boolean).length === 1, 'INVALID_INPUT', 'Choose exactly one of --content, --from, or --stdin.');
  const bytes = from !== undefined ? (await context.workspace.files.read(from)).bytes : flags.stdin ? await context.input() : encodeText(inline!);
  const encoding = value(flags, 'encoding') ?? 'utf8';
  ensure(['utf8', 'base64'].includes(encoding), 'INVALID_ENCODING', 'Use utf8 or base64. --from copies raw bytes by default.');
  if (encoding === 'base64') {
    const text = Buffer.from(bytes).toString('utf8').trim();
    ensure(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text), 'INVALID_ENCODING', 'Invalid base64 input.');
    return Buffer.from(text, 'base64');
  }
  return bytes;
}
const contentOptions = { content: 'string', from: 'string', stdin: 'boolean', encoding: 'string' } as const;

export function commands(registry: Registry, services: WorkflowServices): Command[] {
  const generatorCatalog = () => [...registry.generators.values()].map(({ id, description }) => ({ id, description })).concat({ id: 'document', description: 'Render an Obsidian Markdown/frontmatter template with typed values.' });
  const catalog = () => ({
    name: 'The Forge', version: metadata.version, apiVersion: 1, node: metadata.engines.node,
    globalOptions, output: '{ ok, data?, error?: {code,message}, events, warnings }',
    commands: [...registry.commands.values()].map(({ id, description, usage, options }) => ({ id, description, usage, options: options ?? {} })),
    generators: generatorCatalog(),
    skills: [...registry.skills.keys()],
  });
  return [
    ...workflowCommands(services),
    { id: 'help', description: 'Discover commands and usage without prompts.', usage: 'help [command]', run(args) {
      arity(args, 0, 1);
      if (!args[0]) return catalog();
      const command = registry.commands.get(args[0]); ensure(command, 'UNKNOWN_COMMAND', args[0]);
      const { id, description, usage, options } = command; return { id, description, usage, options: options ?? {}, globalOptions };
    } },
    { id: 'schema', description: 'Machine-readable capability catalog.', usage: 'schema', run(args) { arity(args, 0); return catalog(); } },
    { id: 'formats', description: 'Native Obsidian formats and supported operations.', usage: 'formats', run(args) {
      arity(args, 0); return { nativeFormats, structured: ['md', 'canvas', 'base'], attachments: 'Lossless byte read, copy, replace and embed; no built-in transcoding, rendering or PDF content editing.', otherFiles: 'Opaque bytes; plugins can provide additional processing.' };
    } },
    { id: 'list', description: 'List regular files in stable path order; skip symlinks, Git and node_modules.', usage: 'list [--kind markdown]', options: { kind: 'string' }, async run(args, flags, { workspace }) {
      arity(args, 0); const kind = value(flags, 'kind'); return { files: (await workspace.files.list()).filter(p => !kind || fileKind(p) === kind).map(path => ({ path, kind: fileKind(path) })) };
    } },
    { id: 'read', description: 'Read a document or base64 attachment with its SHA-256 revision.', usage: 'read <path>', async run(args, _, { workspace }) { arity(args, 1); return workspace.read(args[0]!); } },
    { id: 'validate', description: 'Validate Markdown frontmatter, Canvas graph, or Base structure.', usage: 'validate <path>', async run(args, _, { workspace }) {
      arity(args, 1); const file = await workspace.files.read(args[0]!); workspace.codec.validate(file.path, file.bytes);
      return { path: file.path, valid: true, kind: fileKind(file.path), validation: ['markdown', 'canvas', 'base'].includes(fileKind(file.path)) ? 'structure' : 'opaque-bytes' };
    } },
    { id: 'create', description: 'Create a note, Canvas, Base, or file. Existing files are refused.', usage: 'create <path> [--content text | --from path | --stdin] [--encoding base64]', options: contentOptions, async run(args, flags, context) {
      arity(args, 1); const path = args[0]!;
      const hasInput = flags.content !== undefined || flags.from !== undefined || flags.stdin === true;
      const kind = fileKind(path);
      ensure(hasInput || flags.encoding === undefined, 'INVALID_INPUT', '--encoding requires an input source.');
      ensure(hasInput || ['markdown', 'canvas', 'base'].includes(kind), 'INVALID_INPUT', 'Attachments require content, from, or stdin.');
      const bytes = hasInput ? await content(flags, context) : kind === 'canvas' ? encodeText('{"nodes":[],"edges":[]}\n') : kind === 'base' ? encodeYaml({ views: [{ type: 'table', name: 'Table' }] }) : encodeText('');
      return context.workspace.write([{ path, bytes }]);
    } },
    { id: 'write', description: 'Create or replace a file; replacement requires its current revision.', usage: 'write <path> (--content text | --from path | --stdin) [--encoding base64] [--if-match sha256]', options: { ...contentOptions, 'if-match': 'string' }, async run(args, flags, context) {
      arity(args, 1); return context.workspace.write([{ path: args[0]!, bytes: await content(flags, context), expectedRevision: value(flags, 'if-match') }]);
    } },
    { id: 'edit', description: 'Append to Markdown or replace exactly one literal match.', usage: 'edit <note.md> --if-match sha256 (--append --content text | --find text --replace text)', options: { 'if-match': 'string', append: 'boolean', content: 'string', find: 'string', replace: 'string' }, async run(args, flags, { workspace }) {
      arity(args, 1); const path = args[0]!;
      ensure(fileKind(path) === 'markdown', 'UNSUPPORTED_EDIT', 'Use edit for Markdown, patch for Canvas/Bases, and write for attachments.');
      const revision = value(flags, 'if-match', true)!;
      return workspace.edit(path, revision, bytes => {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (flags.append) { ensure(flags.find === undefined && flags.replace === undefined, 'INVALID_INPUT', 'Do not combine append and replace.'); return encodeText(text + value(flags, 'content', true)!); }
        ensure(flags.content === undefined, 'INVALID_INPUT', '--content requires --append.');
        const find = value(flags, 'find', true)!, replacement = value(flags, 'replace', true)!;
        ensure(find.length > 0 && text.indexOf(find) >= 0 && text.indexOf(find, text.indexOf(find) + find.length) < 0, 'AMBIGUOUS_EDIT', 'The find text must match exactly once.');
        return encodeText(text.replace(find, () => replacement));
      });
    } },
    { id: 'properties', description: 'Merge YAML frontmatter properties while preserving the Markdown body.', usage: 'properties <note.md> --set JSON --if-match sha256', options: { set: 'string', 'if-match': 'string' }, async run(args, flags, { workspace }) {
      arity(args, 1); ensure(fileKind(args[0]!) === 'markdown', 'UNSUPPORTED_EDIT', 'Properties require a Markdown note.');
      const changes = parseJson(value(flags, 'set', true)!); ensure(isRecord(changes), 'INVALID_INPUT', '--set must be a JSON object.');
      return workspace.edit(args[0]!, value(flags, 'if-match', true)!, bytes => workspace.codec.properties(bytes, changes));
    } },
    { id: 'patch', description: 'Set a Canvas/Base JSON Pointer; - appends to an existing array.', usage: 'patch <path> --pointer /nodes/- --value JSON --if-match sha256', options: { pointer: 'string', value: 'string', 'if-match': 'string' }, async run(args, flags, { workspace }) {
      arity(args, 1); const pointer = value(flags, 'pointer', true)!, data = parseJson(value(flags, 'value', true)!);
      return workspace.edit(args[0]!, value(flags, 'if-match', true)!, bytes => workspace.codec.patch(args[0]!, bytes, pointer, data));
    } },
    { id: 'make', description: 'Generate TypeScript, plugins, or documents from Obsidian templates.', usage: 'make [generator Name] [--out directory] | make document Title --template name.md [--values JSON | --values-from path] [--date ISO]', options: { out: 'string', template: 'string', values: 'string', 'values-from': 'string', date: 'string' }, async run(args, flags, context) {
      if (args.length === 0) return { generators: generatorCatalog() };
      arity(args, 2);
      if (args[0] === 'document') return makeDocument(args[1]!, flags, context, services);
      ensure(['template', 'values', 'values-from', 'date'].every(key => flags[key] === undefined), 'INVALID_ARGUMENT', 'Template options require make document.');
      const generator = registry.generators.get(args[0]!); ensure(generator, 'UNKNOWN_GENERATOR', args[0]!);
      const directory = value(flags, 'out') ?? (generator.id === 'plugin' ? services.loaded.config.paths.plugins : services.loaded.config.paths.generated);
      const writes = await generator.generate(args[1]!, directory);
      const result = await context.workspace.write(writes);
      return { generator: generator.id, ...result, ...(context.workspace.dryRun ? { preview: writes.map(w => ({ path: w.path, content: Buffer.from(w.bytes).toString('utf8') })) } : {}) };
    } },
    { id: 'events', description: 'List invocation event contracts.', usage: 'events', run(args, _, { events }) { arity(args, 0); return { events: events.ids(), delivery: 'Ordered, awaited, per-listener snapshots; failures become warnings. File events follow successful commits. No persistent replay.' }; } },
    { id: 'plugins', description: 'List explicitly loaded plugin manifests.', usage: '[--config bin/config.json] plugins', run(args) { arity(args, 0); return { plugins: registry.plugins.map(p => p.manifest) }; } },
    { id: 'skills', description: 'List, read or install bundled and plugin agent skills.', usage: 'skills [list | show <id> | install] [--out .agents/skills]', options: { out: 'string' }, async run(args, flags, { workspace }) {
      const action = args[0] ?? 'list';
      if (action === 'list') { arity(args, 0, 1); return { skills: [...registry.skills.keys()] }; }
      if (action === 'show') { arity(args, 2); const skill = registry.skills.get(args[1]!); ensure(skill, 'UNKNOWN_SKILL', args[1]!); return skill; }
      ensure(action === 'install', 'INVALID_ARGUMENT', 'Use skills list, show, or install.'); arity(args, 1);
      const directory = value(flags, 'out') ?? services.loaded.config.paths.skills;
      return workspace.write([...registry.skills.values()].map(skill => ({ path: `${directory}/${skill.id}/SKILL.md`, bytes: encodeText(skill.content) })));
    } },
  ];
}
