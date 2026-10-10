/**
 * Backlog sync in the showcase: one base with two views bound to two Azure DevOps connections. The connections live
 * in the temporary generation workspace's configuration (never in this checkout's), and the token variables are
 * never set, so generation stays offline: nothing is linked yet, and the dry run plans creates without a request.
 */
const syncPaths = { base: 'backlog/Azure DevOps sync.base' };

/** Connection profiles for the generation workspace's `plugins.settings.connector.connections`. */
export const showcaseConnections = {
  contoso: { platform: 'azure-devops', organization: 'https://dev.azure.com/contoso-trailhead', project: 'Trailhead', process: 'agile', iterationRoot: 'Trailhead', tokenEnv: 'TRAILHEAD_CONTOSO_PAT' },
  fabrikam: { platform: 'azure-devops', organization: 'https://dev.azure.com/fabrikam-delivery', project: 'Delivery', process: 'scrum', tokenEnv: 'TRAILHEAD_FABRIKAM_PAT', linkProperty: 'fabrikam' },
};

const bindings = `    homeFolder: "backlog"
    stateProperty: note.status
    stateValues: Open, Active, Done
    priorityProperty: note.priority
    iterationProperty: note.iteration
    dependsOnProperty: note.dependsOn`;

// Planning work syncs to the product organization, delivery work to the delivery team's organization.
const base = `filters:
  and:
    - "file.inFolder(\\"backlog\\")"
    - file.ext == "md"
views:
  - type: product-backlog
    name: Planning
    filters:
      or:
        - type == "Epic"
        - type == "Feature"
        - type == "PBI"
${bindings}
    connection: contoso
  - type: product-backlog
    name: Delivery
    filters:
      or:
        - type == "Task"
        - type == "Bug"
${bindings}
    connection: fabrikam
`;

/**
 * Adds the sync base, then records the connections and a dry-run sync of both views for the README.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
export function buildSync(cli) {
  cli.begin('Backlog sync');
  cli.create(syncPaths.base, base);
  const connections = cli.run(['connectors', 'list']).data.connections;
  const plan = cli.run(['backlog', 'sync', '--base', syncPaths.base, '--dry-run']).data;
  return { connections, plan };
}

/** @typedef {ReturnType<typeof buildSync>} SyncSummary */

/** The README section on backlog sync. @param {SyncSummary} summary */
export function syncSection(summary) {
  const connections = summary.connections.map((/** @type {any} */ entry) => `| \`${entry.id}\` | ${entry.organization} | ${entry.project} | ${entry.process} | ${entry.valid ? 'valid' : entry.issues.join('; ')} |`);
  const views = summary.plan.views.map((/** @type {any} */ view) => [
    `**${view.view}** → \`${view.connection}\`: ${view.created.length} work items to create, parents first:`,
    '',
    ...view.created.map((/** @type {any} */ entry) => `- \`${entry.path}\` (${entry.fields.join(', ')})`),
    ...(view.skipped.length > 0 ? ['', `Skipped: ${view.skipped.map((/** @type {any} */ skip) => `\`${skip.path}\` (${skip.reason})`).join(', ')}.`] : []),
    '',
  ].join('\n'));
  return [
    `[${syncPaths.base}](<${syncPaths.base}>) binds two \`product-backlog\` views to two Azure DevOps connections with the view option \`connection: <id>\`: planning work (Epics, Features, PBIs) syncs to one organization, delivery work (Tasks, Bugs) to another. The connections are workspace configuration, so they are not part of this project; the generation workspace's \`bin/config.json\` held:`,
    '',
    '```json',
    JSON.stringify({ plugins: { settings: { connector: { connections: showcaseConnections } } } }, null, 2),
    '```',
    '',
    '`connectors list` reported:',
    '',
    '| Connection | Organization | Project | Process | Profile |',
    '| --- | --- | --- | --- | --- |',
    ...connections,
    '',
    'Generation never contacts Azure DevOps: no note is linked yet, so `backlog sync --dry-run` plans the creates without a request and writes nothing. With a token in each `tokenEnv` variable, `backlog sync` would create these work items with their parent links and write each note\'s link property. The dry run planned:',
    '',
    ...views,
    'The Forge documentation explains the setup in its how-to guide "Sync a backlog with Azure DevOps".',
    '',
  ].join('\n');
}
