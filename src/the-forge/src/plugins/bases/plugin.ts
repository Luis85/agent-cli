import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { CommandContext } from '../../application/plugins/registry.ts';
import { Bases } from './application/query.ts';
import { NodeBasesQueryEngine } from './infrastructure/engine.ts';
import { basesCommand } from './presentation/commands.ts';
import { validateBaseFile } from './application/validation.ts';
import { baseDefinitionIssues } from './infrastructure/validation.ts';
import { basesStrings } from './presentation/strings.ts';
import { localizedQuery } from './presentation/messages.ts';

/**
 * The `bases` core plugin: native Obsidian `.base` views evaluated as file repositories over the command scope's
 * files and the kernel metadata cache. Disabling it removes the `bases` command; `.base` files stay ordinary
 * documents for `read`, `validate` and `patch`. It provides the `bases.query` and `bases.validation` services to
 * other plugins.
 */
export const basesPlugin: CorePlugin = {
  manifest: {
    id: 'bases', name: 'Bases', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Query native Obsidian Bases views as file repositories without running Obsidian.',
  },
  strings: basesStrings,
  create: host => {
    const bases = (context: CommandContext) => new Bases(new NodeBasesQueryEngine(
      context.workspace.files, context.workspace.codec, () => context.metadata.load(), host.fileDates(context.root),
    ));
    return {
      commands: [basesCommand(bases)],
      // `bases.query` evaluates a saved view in the caller's command scope: its result files in result order.
      // `bases.validation` reports what `bases query` would reject in a `.base` file before evaluating it, without throwing.
      provides: {
        'bases.query': { query: async (context: CommandContext, path: string, options: { view?: string }) => localizedQuery(await bases(context).query(path, options), context.language) },
        'bases.validation': { validate: (context: CommandContext, path: string) => validateBaseFile(context.workspace.files, context.workspace.codec, baseDefinitionIssues, path) },
      },
      errors: [{
        code: 'BASE_TIMEOUT', category: 'input', summary: 'A Bases query exceeded its expression evaluation time budget.',
        hint: 'Simplify the expressions of the .base file named in the message (avoid nested regular-expression quantifiers such as (a+)+) or narrow its filters.',
      }],
      strings: {
        de: {
          errors: {
            BASE_TIMEOUT: { summary: 'Eine Bases-Abfrage hat ihr Zeitbudget für die Auswertung von Ausdrücken überschritten.', hint: 'Vereinfachen Sie die Ausdrücke der in der Meldung genannten .base-Datei (vermeiden Sie verschachtelte Quantoren in regulären Ausdrücken wie (a+)+) oder grenzen Sie ihre Filter ein.' },
          },
          commands: { bases: 'Native Obsidian-Bases-Ansichten ohne laufendes Obsidian als Datei-Repositories abfragen.' },
          actions: {
            'bases list': 'Die sichtbaren .base-Dateien im Bereich des Befehls auflisten.',
            'bases inspect': 'Eine .base-Definition mit ihren Ansichten zurückgeben.',
            'bases query': 'Eine Ansicht auswerten und ihre passenden Dateien zurückgeben.',
            'bases capabilities': 'Das Kompatibilitätsprofil der eigenständigen Bases-Auswertung beschreiben.',
          },
        },
      },
    };
  },
};
