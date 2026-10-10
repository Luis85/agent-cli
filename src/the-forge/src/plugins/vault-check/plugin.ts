import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { PluginContext } from '../../application/plugins/registry.ts';
import { pathGlob } from '../../domain/documents/path-glob.ts';
import { errorMessage } from '../../domain/shared/errors.ts';
import { scopeSources, type BaseIssue } from './application/sources.ts';
import { ruleDefaults, ruleIds, ruleSettings, type RuleSetting } from './domain/rules.ts';
import { vaultCommand } from './presentation/command.ts';
import { englishMessages, germanMessages } from './presentation/messages.ts';

/** The `bases` core plugin's service, used only when it is enabled: an optional dependency, never an import. */
const basesValidation = 'bases.validation';
interface BasesValidationService { validate(context: PluginContext, path: string): Promise<readonly BaseIssue[]> }

/** Each ignore glob must compile, so a malformed glob is a configuration error rather than a command failure. */
function ignoreIssues(settings: Readonly<Record<string, unknown>>): string[] {
  return ((settings.ignore ?? []) as string[]).flatMap((pattern, index) => {
    const path = `plugins.settings.vault-check.ignore[${index}]`;
    try { pathGlob(pattern, path); return []; }
    catch (error) { return [`${path}: ${errorMessage(error).slice(path.length + 1)}`]; }
  });
}

/**
 * The `vault-check` core plugin: the read-only `vault` command, which checks the vault's link graph, notes, Canvas
 * and Bases files and properties (`vault check`) and inventories its tags and properties (`vault tags`, `vault
 * properties`) from the kernel metadata cache. Its id is not `vault` because that is the host's Obsidian event
 * namespace (`vault.create|modify|delete|rename`); it emits no events. `invalid-base` uses the optional
 * `bases.validation` service of the `bases` plugin.
 */
export const vaultCheckPlugin: CorePlugin = {
  manifest: {
    id: 'vault-check', name: 'Vault check', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Check the vault for broken links, invalid files and inconsistent properties, and inventory its tags and properties.',
  },
  create: () => ({
    optional: [basesValidation],
    commands: [vaultCommand(context => {
      const plugin = context as PluginContext;
      const bases = plugin.services.has(basesValidation) ? plugin.services.get<BasesValidationService>(basesValidation) : null;
      return {
        sources: scopeSources(context.workspace.files, context.metadata, bases && { validate: path => bases.validate(plugin, path) }),
        rules: (plugin.settings?.rules ?? {}) as Record<string, RuleSetting>,
        ignore: (plugin.settings?.ignore ?? []) as string[],
        t: key => plugin.t(key),
      };
    })],
    settings: {
      type: 'object', additionalProperties: false,
      properties: {
        rules: {
          type: 'object', additionalProperties: false, default: {},
          description: 'Severity per rule id (error, warning, info or off), overriding the rule\'s default.',
          properties: Object.fromEntries(ruleIds.map(id => [id, { type: 'string', enum: [...ruleSettings], description: `Default ${ruleDefaults[id]}.` }])),
        },
        ignore: {
          type: 'array', items: { type: 'string', minLength: 1 }, default: [],
          description: 'Path globs of files that vault check, tags and properties skip; they remain link targets.',
        },
      },
    },
    validateSettings: ignoreIssues,
    errors: [{
      code: 'VAULT_CHECK_FAILED', category: 'input', summary: 'vault check --strict found findings with error severity.',
      hint: 'Fix the findings in error.details.findings (each names its rule, path, line and hint), then run vault check --strict again; vault check without --strict lists every finding.',
    }],
    strings: {
      en: { messages: englishMessages },
      de: {
        commands: { vault: 'Den Vault auf defekte Links, ungültige Dateien und uneinheitliche Eigenschaften prüfen und seine Tags und Eigenschaften auflisten.' },
        actions: {
          'vault check': 'Befunde jeder aktiven Regel mit Schweregrad, Fundstelle, Meldung und Hinweis melden; --strict schlägt bei Befunden mit Schweregrad error fehl.',
          'vault tags': 'Frontmatter- und Inline-Tags mit den Dateien auflisten, die sie verwenden; verschachtelte Tags zählen auch für ihre übergeordneten Tags.',
          'vault properties': 'Frontmatter-Eigenschaften mit Wertanzahl, abgeleiteten Typen, Konflikten und dem in .obsidian/types.json festgelegten Typ auflisten.',
        },
        errors: {
          VAULT_CHECK_FAILED: {
            summary: 'vault check --strict hat Befunde mit Schweregrad error gefunden.',
            hint: 'Beheben Sie die Befunde in error.details.findings (jeder nennt Regel, Pfad, Zeile und Hinweis) und führen Sie vault check --strict erneut aus; vault check ohne --strict listet jeden Befund.',
          },
        },
        messages: germanMessages,
      },
    },
  }),
};
