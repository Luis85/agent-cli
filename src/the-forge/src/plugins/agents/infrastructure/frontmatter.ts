import { parse, stringify } from 'yaml';
import { forgeError, isRecord } from '../../../domain/shared/errors.ts';
import type { FrontmatterCodec } from '../application/ports.ts';

/** Claude agent and skill files: YAML frontmatter without line folding, then the Markdown body verbatim. */
export const markdownFrontmatter: FrontmatterCodec = {
  render(metadata, body) {
    return `---\n${stringify(metadata, { lineWidth: 0 })}---\n${body}`;
  },
  parse(text) {
    const normalized = text.startsWith('﻿') ? text.slice(1) : text;
    const match = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/.exec(normalized);
    if (!match) throw forgeError('INVALID_CLAUDE_AGENT', 'Claude agent and skill files require YAML frontmatter on the first line.');
    let metadata: unknown;
    try { metadata = parse(match[1] ?? '') ?? {}; }
    catch (error) { throw forgeError('INVALID_CLAUDE_AGENT', `Invalid frontmatter: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`); }
    if (!isRecord(metadata)) throw forgeError('INVALID_CLAUDE_AGENT', 'Frontmatter must be a mapping.');
    return { metadata, body: normalized.slice(match[0].length) };
  },
};
