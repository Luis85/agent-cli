import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import { Bases } from './application/query.ts';
import { NodeBasesQueryEngine } from './infrastructure/engine.ts';
import { basesCommand } from './presentation/commands.ts';

/**
 * The `bases` core plugin: native Obsidian `.base` views evaluated as file repositories over the command scope's
 * files and the kernel metadata cache. Disabling it removes the `bases` command; `.base` files stay ordinary
 * documents for `read`, `validate` and `patch`.
 */
export const basesPlugin: CorePlugin = {
  manifest: {
    id: 'bases', name: 'Bases', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Query native Obsidian Bases views as file repositories without running Obsidian.',
  },
  create: host => ({
    commands: [basesCommand(context => new Bases(new NodeBasesQueryEngine(
      context.workspace.files, context.workspace.codec, () => context.metadata.load(), host.fileDates(context.root),
    )))],
    strings: {
      de: {
        commands: { bases: 'Native Obsidian-Bases-Ansichten ohne laufendes Obsidian als Datei-Repositories abfragen.' },
        actions: {
          'bases list': 'Die sichtbaren .base-Dateien im Bereich des Befehls auflisten.',
          'bases inspect': 'Eine .base-Definition mit ihren Ansichten zurückgeben.',
          'bases query': 'Eine Ansicht auswerten und ihre passenden Dateien zurückgeben.',
          'bases capabilities': 'Das Kompatibilitätsprofil der eigenständigen Bases-Auswertung beschreiben.',
        },
      },
    },
  }),
};
