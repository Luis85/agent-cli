import { project } from './project.mjs';

/**
 * Sharing definitions between libraries: the component and interaction libraries preview their exports, and the
 * data-source library exports its definitions to a hidden exchange folder (outside the vault, so the copies never
 * make a wikilink ambiguous), from which an import into a fresh library is previewed.
 */
const workspacePath = (/** @type {string} */ path) => `${project.directory}/${path}`;
const exchange = {
  components: ['components', 'export', '--library', workspacePath('library/components'), '--interactions-library', workspacePath('library/interactions'), '--out', workspacePath('.exchange/components'), '--dry-run'],
  interactions: ['interactions', 'export', '--library', workspacePath('library/interactions'), '--out', workspacePath('.exchange/interactions'), '--dry-run'],
  exportSources: ['data-sources', 'export', '--library', workspacePath('library/data-sources'), '--out', workspacePath('.exchange/data-sources')],
  importSources: ['data-sources', 'import', '--from', workspacePath('.exchange/data-sources'), '--library', workspacePath('.exchange/library'), '--dry-run'],
};

/** @typedef {{ components: number, interactions: number, exported: string[], imported: string[] }} ExchangeSummary */

/**
 * @param {import('./cli.mjs').ForgeCli} cli
 * @returns {Promise<ExchangeSummary>}
 */
export async function buildExchange(cli) {
  cli.begin('Library exchange');
  const exported = cli.run(exchange.exportSources).data.sources;
  const [components, interactions, imported] = await cli.runConcurrently([exchange.components, exchange.interactions, exchange.importSources]);
  if (imported.data.dryRun !== true || imported.data.changes.length !== exported.length) throw new Error('data-sources import --dry-run did not preview every exported definition');
  return { components: components.data.components.length, interactions: interactions.data.interactions.length, exported, imported: imported.data.sources };
}

/** @param {string[]} args */
const command = args => `node bin/forge.js ${args.join(' ')}`;

/** The README paragraph on library exchange. @param {ExchangeSummary} summary */
export function exchangeSection(summary) {
  return [
    '## Library exchange',
    '',
    'Component, interaction and data-source definitions move between workspaces as plain Markdown folders. Exports and imports are create-only; dry runs list every file they would write.',
    '',
    '```sh',
    command(exchange.components),
    command(exchange.interactions),
    command(exchange.exportSources),
    command(exchange.importSources),
    '```',
    '',
    `The component export would write ${summary.components} definitions and the interaction export ${summary.interactions}. The data-source export wrote ${summary.exported.map(id => `\`${id}\``).join(' and ')} to \`.exchange/data-sources\`, a hidden folder that Obsidian and the vault index skip, and importing them into a new library previews ${summary.imported.length} creates.`,
    '',
  ].join('\n');
}
