import { fileKinds, fileKind, isInTrash } from '../../domain/documents/file.ts';
import { pathFilter, recordingFilter } from '../../domain/documents/path-glob.ts';
import { metadataMatches, noteFilters } from '../../domain/metadata/note-filters.ts';
import { kernelMessage } from '../../domain/shared/kernel-messages.ts';
import { Pager } from '../../domain/shared/paging.ts';
import type { Command } from '../../application/plugins/registry.ts';
import { integer, value } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { listOutput } from './output.ts';

/** Files per page when --limit is omitted. */
const defaultListLimit = 500;

/**
 * `list`: one page of the scope's files in path order. `.trash` is skipped unless --include-trash is given or --path
 * starts there; --tag and --property keep only notes whose metadata matches, as `search` filters them.
 */
export function listCommand(): Command {
  return {
    id: 'list', description: 'List regular files in stable path order; skip symlinks, Git, node_modules and .trash.',
    examples: ['list --kind markdown --path notes', 'list --tag plan --limit 100'],
    usage: 'list [--kind markdown|canvas|base|image|audio|video|pdf|text|attachment] [--path glob] [--tag tag] [--property key[=value]] [--include-trash] [--limit count] [--cursor token] [--project id]',
    scope: 'project', projectOption: 'project', discovery: false, mutating: false, args: [],
    options: {
      kind: option.string('Only files of this kind.', { enum: fileKinds }),
      path: option.string('Only files whose root-relative path matches this glob (*, **, ?, [abc], {a,b}), or that are this file or below this folder.'),
      tag: option.string('Only notes with this tag or a nested tag below it.'),
      property: option.string('Only notes whose frontmatter has key (not null), or key=value.'),
      'include-trash': option.boolean('Also list files in .trash, where delete moves files.'),
      limit: option.string('Maximum number of files per page; a truncated page returns nextCursor.', { default: String(defaultListLimit) }),
      cursor: option.string('Continue after the page that returned this nextCursor, with the same filters.'),
      project: option.string('Use this project instead of the selected project.'),
    },
    output: listOutput,
    async run(_args, flags, { workspace, metadata, events }) {
      const kind = value(flags, 'kind'), glob = value(flags, 'path'), filters = noteFilters(value(flags, 'tag'), value(flags, 'property'));
      const inPath = recordingFilter(glob === undefined ? () => true : pathFilter(glob));
      const trash = flags['include-trash'] === true || (glob !== undefined && isInTrash(glob.replace(/^\.\//, '').split('/')[0]!));
      const query = { command: 'list', kind: kind ?? null, path: glob ?? null, trash, ...filters };
      const pager = new Pager<string>({ limit: integer(flags, 'limit', 1) ?? defaultListLimit, cursor: value(flags, 'cursor') }, query, path => [path]);
      const cache = filters.tag !== undefined || filters.property !== undefined ? await metadata.load() : undefined;
      for (const path of await workspace.files.list()) {
        if (!inPath.matches(path) || (!trash && isInTrash(path)) || (kind && fileKind(path) !== kind)) continue;
        if (cache && !metadataMatches(cache.getFileCache(path), filters)) continue;
        pager.offer(path);
      }
      if (glob !== undefined && !inPath.matched()) events.warn(kernelMessage('PATH_MATCHED_NOTHING', { option: '--path', pattern: glob }));
      const nextCursor = pager.nextCursor();
      return { files: pager.items.map(path => ({ path, kind: fileKind(path) })), total: pager.total, ...(nextCursor === undefined ? {} : { nextCursor }) };
    },
  };
}
