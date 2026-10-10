import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { PluginContext } from '../../application/plugins/registry.ts';
import { errorMessage } from '../../domain/shared/errors.ts';
import { pathGlob } from '../../domain/documents/path-glob.ts';
import { linksCommand } from './presentation/command.ts';

/** Each root must compile as a path glob, so a malformed glob is a configuration error rather than a command failure. */
function rootIssues(settings: Readonly<Record<string, unknown>>): string[] {
  return ((settings.roots ?? []) as string[]).flatMap((root, index) => {
    const path = `plugins.settings.links.roots[${index}]`;
    try { pathGlob(root, path); return []; }
    catch (error) { return [`${path}: ${errorMessage(error).slice(path.length + 1)}`]; }
  });
}

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
    validateSettings: rootIssues,
    strings: {
      de: { commands: { links: 'Ausgehende Links, Rückverweise, unaufgelöste Links, verwaiste Notizen und Sackgassen aus dem Metadaten-Cache melden.' } },
    },
  }),
};
