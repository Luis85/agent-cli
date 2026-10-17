import type { Command, PluginContext } from '../../../application/plugins/registry.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import { pathGlob } from '../../../domain/documents/path-glob.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import type { MetadataCache } from '../../../application/metadata/ports.ts';
import { linksOutput } from './output.ts';
import { deadendNotes, linksBack, linksOut, orphanNotes, unresolvedLinks } from '../application/links.ts';

const actions = ['out', 'back', 'unresolved', 'orphans', 'deadends'] as const;
const noteActions: readonly string[] = ['out', 'back'];
const path = option.string('For unresolved, orphans and deadends: only files whose root-relative path matches this glob.');

/** The metadata cache of one command context, and the configured globs of notes that are never orphans. */
export interface LinksService { cache(): Promise<MetadataCache>; roots(): readonly string[] }

export function linksCommand(service: (context: PluginContext) => LinksService): Command<PluginContext> {
  return {
    id: 'links', description: 'Report outgoing links, backlinks, unresolved links, orphans and dead ends from the metadata cache.',
    usage: 'links out <note> | back <note> | unresolved [--path glob] | orphans [--path glob] | deadends [--path glob]',
    scope: 'project', discovery: false, mutating: false, unknownAction: 'INVALID_ARGUMENT',
    actions: {
      out: { description: 'Every link, embed, frontmatter link and Canvas file node of one file, with location and resolution.', usage: 'links out <note>', output: linksOutput.out },
      back: { description: 'References in other files that resolve to one file.', usage: 'links back <note>', output: linksOutput.back },
      unresolved: { description: 'Every missing or ambiguous reference in the vault, with candidates for ambiguous ones.', usage: 'links unresolved [--path glob]', options: { path }, output: linksOutput.unresolved },
      orphans: { description: 'Markdown and Canvas notes that no other file links to or embeds, except configured roots.', usage: 'links orphans [--path glob]', options: { path }, output: linksOutput.orphans },
      deadends: { description: 'Markdown and Canvas notes without a link to another file.', usage: 'links deadends [--path glob]', options: { path }, output: linksOutput.deadends },
    },
    args: [
      { name: 'action', description: 'out, back, unresolved, orphans or deadends.', required: true, enum: actions },
      { name: 'note', description: 'The vault path of the file for out and back.' },
    ],
    errors: ['NOT_FOUND'],
    async run(args, flags, context) {
      const action = args[0];
      ensure((actions as readonly (string | undefined)[]).includes(action), 'INVALID_ARGUMENT', `Use links ${actions.join(', links ')}.`);
      const links = service(context);
      if (noteActions.includes(action!)) {
        arity(args, 2);
        const cache = await links.cache();
        return action === 'out' ? linksOut(cache, args[1]!) : linksBack(cache, args[1]!);
      }
      arity(args, 1);
      const glob = value(flags, 'path');
      const include = glob === undefined ? () => true : pathGlob(glob);
      const cache = await links.cache();
      if (action === 'unresolved') return unresolvedLinks(cache, include);
      if (action === 'deadends') return deadendNotes(cache, include);
      const roots = links.roots().map(root => pathGlob(root, 'plugins.settings.links.roots'));
      return orphanNotes(cache, include, path => roots.some(root => root(path)));
    },
  };
}
