import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { PluginContext } from '../../application/plugins/registry.ts';
import { searchFiles } from './application/search.ts';
import { vmSearchBudget } from './infrastructure/budget.ts';
import { searchCommand } from './presentation/command.ts';

const defaultTimeoutMs = 10_000;

/**
 * The `search` core plugin: literal and regular-expression search over the scope's text files with path, kind,
 * tag and property filters, deterministic ordering and cursor paging. Read-only. `plugins.settings.search.timeoutMs`
 * bounds the matching time of one search.
 */
export const searchPlugin: CorePlugin = {
  manifest: {
    id: 'search', name: 'Search', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Search text files for literal or regular-expression patterns with metadata filters and paging.',
  },
  create: () => ({
    commands: [searchCommand(context => (query, page) => searchFiles({
      files: context.workspace.files,
      metadata: () => context.metadata.load(),
      budget: vmSearchBudget(Number((context as PluginContext).settings?.timeoutMs ?? defaultTimeoutMs)),
    }, query, page))],
    settings: {
      type: 'object', additionalProperties: false,
      properties: {
        timeoutMs: {
          type: 'integer', minimum: 100, maximum: 600_000, default: defaultTimeoutMs,
          description: 'Milliseconds one search may spend matching before it fails with SEARCH_TIMEOUT.',
        },
      },
    },
    errors: [
      {
        code: 'INVALID_SEARCH_PATTERN', category: 'input', summary: 'The search pattern is invalid.',
        hint: 'Fix the regular expression named in the message, or search for literal text without --regex.',
      },
      {
        code: 'SEARCH_TIMEOUT', category: 'input', summary: 'The search exceeded its matching time budget.',
        hint: 'Simplify the regular expression (avoid nested quantifiers such as (a+)+), narrow --path or --kind, or raise plugins.settings.search.timeoutMs.',
      },
    ],
    strings: {
      de: {
        commands: { search: 'Textdateien nach wörtlichem Text oder einem regulären Ausdruck durchsuchen; Treffer mit Zeile, Spalte, Ausschnitt und Revision.' },
        errors: {
          INVALID_SEARCH_PATTERN: { summary: 'Das Suchmuster ist ungültig.', hint: 'Korrigieren Sie den in der Meldung genannten regulären Ausdruck oder suchen Sie ohne --regex nach wörtlichem Text.' },
          SEARCH_TIMEOUT: { summary: 'Die Suche hat ihr Zeitbudget für den Abgleich überschritten.', hint: 'Vereinfachen Sie den regulären Ausdruck (vermeiden Sie verschachtelte Quantoren wie (a+)+), grenzen Sie --path oder --kind ein oder erhöhen Sie plugins.settings.search.timeoutMs.' },
        },
      },
    },
  }),
};
