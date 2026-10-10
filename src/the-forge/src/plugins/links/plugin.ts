import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { PluginContext } from '../../application/plugins/registry.ts';
import { linksCommand } from './presentation/command.ts';

/**
 * The `links` core plugin: outgoing links, backlinks, unresolved links, orphans and dead ends of the command
 * scope, read from the kernel metadata cache. Read-only. `plugins.settings.links.roots` lists globs of entry notes
 * (an index or home note) that are never reported as orphans.
 */
export const linksPlugin: CorePlugin = {
  manifest: {
    id: 'links', name: 'Links', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Report outgoing links, backlinks, unresolved links, orphans and dead ends from the metadata cache.',
  },
  create: () => ({
    commands: [linksCommand(context => ({
      cache: () => context.metadata.load(),
      roots: () => ((context as PluginContext).settings?.roots ?? []) as string[],
    }))],
    settings: {
      type: 'object', additionalProperties: false,
      properties: {
        roots: {
          type: 'array', items: { type: 'string', minLength: 1 }, default: [],
          description: 'Path globs of entry notes, such as an index or home note, that links orphans never reports.',
        },
      },
    },
    strings: {
      de: { commands: { links: 'Ausgehende Links, Rückverweise, unaufgelöste Links, verwaiste Notizen und Sackgassen aus dem Metadaten-Cache melden.' } },
    },
  }),
};
