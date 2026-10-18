import { listOptionItems, option, type CommandFlags } from '../../application/plugins/command-metadata.ts';
import { integer, value } from '../../application/plugins/command-input.ts';
import type { Command } from '../../application/plugins/registry.ts';
import { lineRange } from '../../domain/documents/text-window.ts';
import { readOutput } from './output.ts';
import { defaultReadBytes, markdownParts, readView, type ReadSelection } from './read-view.ts';

/** `--max-bytes`, shared by `read` and `read-many`. */
export const maxBytesOption = option.string('Most bytes of text or attachment content returned per field; longer content is truncated with truncated: true.', { default: String(defaultReadBytes) });
export const maxBytes = (flags: CommandFlags) => integer(flags, 'max-bytes', 1) ?? defaultReadBytes;

function selection(flags: CommandFlags): ReadSelection {
  const parts = value(flags, 'parts'), lines = value(flags, 'lines');
  // The host checked every --parts item against markdownParts.
  return {
    maxBytes: maxBytes(flags),
    ...(parts === undefined ? {} : { parts: new Set(listOptionItems(parts)) }),
    ...(lines === undefined ? {} : { lines: lineRange(lines) }),
  };
}

export function readCommand(): Command {
  return {
    id: 'read', description: 'Read a document, UTF-8 text or base64 attachment with its SHA-256 revision; long content is truncated, and --lines reads a line range.',
    examples: ['read notes/idea.md', 'read notes/idea.md --lines 40-80', 'read notes/idea.md --parts body'],
    usage: 'read <path> [--parts content,properties,body] [--lines start-end] [--max-bytes count] [--project id]',
    scope: 'project', projectOption: 'project', discovery: false, mutating: false,
    args: [{ name: 'path', description: 'Vault path relative to the command scope.', required: true, path: true }], errors: ['NOT_FOUND', 'INVALID_CANVAS', 'INVALID_BASE', 'INVALID_YAML'],
    options: {
      parts: option.string('Comma-separated parts of a Markdown read; content and properties by default.', { enum: markdownParts, list: true }),
      lines: option.string('Only these 1-based, inclusive lines of Markdown or text content: start-end, start- or start.'),
      'max-bytes': maxBytesOption,
      project: option.string('Use this project instead of the selected project.'),
    },
    output: readOutput,
    async run(args, flags, { workspace, events }) {
      const request = selection(flags);
      return readView(await workspace.read(args[0]!), request, message => events.warn(message));
    },
  };
}
