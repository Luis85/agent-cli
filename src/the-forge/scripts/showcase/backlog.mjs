import { vaultPaths } from './vault.mjs';

/** The Trailhead product backlog: a backlog-view compatible base in `backlog/`, outside the documentation tree. */
export const backlogPaths = {
  folder: 'backlog',
  base: 'backlog/Product Backlog.base',
  release: 'Trailhead 1.0',
  notes: 'backlog/release-notes/Trailhead 1.0 release notes.md',
};

// The scaffold from `backlog init`, then the properties and vocabularies this backlog tracks, and a release view.
const base = `filters:
  and:
    - "file.inFolder(\\"backlog\\")"
    - file.ext == "md"
views:
  - type: product-backlog
    name: Backlog
    homeFolder: "backlog"
    stateProperty: note.status
    stateValues: Open, Active, Done
    startedStates: Active
    startedDateProperty: note.started
    finishedDateProperty: note.finished
    startProperty: note.start
    targetProperty: note.due
    priorityProperty: note.priority
    riskProperty: note.risk
    assigneeProperty: note.assignee
    dependsOnProperty: note.dependsOn
    iterationProperty: note.iteration
    iterationGoalProperty: note.goal
    releaseProperty: note.release
    wipLimit.active: "2"
    columnPolicy.done: Reviewed and merged
  - type: product-release
    name: Releases
    membershipProperty: note.release
    versionProperty: note.version
    targetDateProperty: note.target-date
    releaseStatusProperty: note.status
    stateProperty: note.status
    releasedDateProperty: note.released
    releasedStatusValues: Released
    releasedTransitionValue: Released
    dependsOnProperty: note.dependsOn
    riskProperty: note.risk
    criticalRiskValues: 1 - High
    addressedRiskValues: Mitigated
    releaseFolder: backlog/releases
    releaseNotesFolder: backlog/release-notes
`;

/** Items in creation order: type, title and parent. Each lands in its type folder at the end of its siblings. */
const items = [
  ['Epic', 'Trip planning'],
  ['Epic', 'Group sharing'],
  ['Feature', 'Itinerary builder', 'Trip planning'],
  ['Feature', 'Trail guide browser', 'Trip planning'],
  ['Feature', 'Share links', 'Group sharing'],
  ['PBI', 'Draft a trip itinerary', 'Itinerary builder'],
  ['PBI', 'Save trip drafts offline', 'Itinerary builder'],
  ['Bug', 'Duplicate stops after reordering', 'Itinerary builder'],
  ['PBI', 'Browse trail guides by region', 'Trail guide browser'],
  ['PBI', 'Share an itinerary link', 'Share links'],
  ['Task', 'Build the trip card component', 'Draft a trip itinerary'],
  ['Task', 'Wire the trips API adapter', 'Draft a trip itinerary'],
  ['Task', 'Add the share dialog', 'Share an itinerary link'],
];

/**
 * Builds the Trailhead backlog through the `backlog` core plugin with fixed dates, then records the tree, board,
 * release readiness and check results for the README.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
export function buildBacklog(cli) {
  cli.begin('Product backlog');
  cli.run(['backlog', 'init', '--folder', backlogPaths.folder]);
  cli.replace(backlogPaths.base, base);
  for (const name of ['Mara', 'Theo']) cli.create(`backlog/resources/${name}.md`, '---\ntype: Resource\n---\n');
  for (const [type, title, parent] of items) cli.run(['backlog', 'add', type, title, ...(parent ? ['--parent', parent] : []), '--today', '2026-10-12']);
  cli.run(['backlog', 'move', 'Trail guide browser', '--before', 'Itinerary builder']);
  cli.run(['backlog', 'move', 'Duplicate stops after reordering', '--first']);
  cli.run(['backlog', 'set', 'Draft a trip itinerary', '--state', 'Active', '--priority', '1 - Must', '--assignee', 'Mara', '--today', '2026-10-13']);
  cli.run(['backlog', 'set', 'Build the trip card component', '--state', 'Active', '--assignee', 'Mara', '--today', '2026-10-13']);
  cli.run(['backlog', 'set', 'Build the trip card component', '--state', 'Done', '--today', '2026-10-16']);
  cli.run(['backlog', 'set', 'Wire the trips API adapter', '--state', 'Active', '--assignee', 'Theo', '--today', '2026-10-14']);
  cli.run(['backlog', 'set', 'Share an itinerary link', '--state', 'Open', '--priority', '2 - Should', '--risk', '1 - High']);
  cli.run(['backlog', 'set', 'Duplicate stops after reordering', '--state', 'Open', '--priority', '1 - Must']);
  cli.run(['backlog', 'depend', 'Share an itinerary link', '--on', 'Draft a trip itinerary']);
  cli.run(['backlog', 'depend', 'Add the share dialog', '--on', 'Build the trip card component']);

  cli.begin('Iterations and releases');
  const iteration = cli.run(['backlog', 'iteration', 'add', '--goal', 'Plan a first trip', '--today', '2026-10-12']).data.item.title;
  for (const title of ['Draft a trip itinerary', 'Build the trip card component', 'Wire the trips API adapter']) cli.run(['backlog', 'iteration', 'assign', title, iteration]);
  cli.run(['backlog', 'release', 'add', 'Trailhead 0.9 beta', '--release-version', '0.9.0', '--target-date', '2026-10-20', '--status', 'Planned']);
  cli.run(['backlog', 'release', 'join', 'Build the trip card component', 'Trailhead 0.9 beta', '--today', '2026-10-12']);
  cli.run(['backlog', 'release', 'mark-released', 'Trailhead 0.9 beta', '--today', '2026-10-19']);
  cli.run(['backlog', 'release', 'add', backlogPaths.release, '--release-version', '1.0.0', '--target-date', '2026-12-01', '--status', 'Planned']);
  for (const title of ['Draft a trip itinerary', 'Save trip drafts offline', 'Duplicate stops after reordering', 'Browse trail guides by region', 'Share an itinerary link']) {
    cli.run(['backlog', 'release', 'join', title, backlogPaths.release, '--today', '2026-10-12']);
  }
  const readiness = cli.run(['backlog', 'release', 'readiness', backlogPaths.release, '--today', '2026-10-20']).data;
  cli.run(['backlog', 'release', 'notes', backlogPaths.release]);
  cli.guarded(vaultPaths.hub, ['edit', vaultPaths.hub, '--append', '--content', `\n## Product backlog\n\n- Backlog view: [[Product Backlog.base]]\n- Next release: [[${backlogPaths.release}]] and its [[${backlogPaths.release} release notes]]\n`]);

  cli.begin('Backlog reports');
  const tree = cli.run(['backlog', 'tree']).data;
  const board = cli.run(['backlog', 'board']).data;
  const releases = cli.run(['backlog', 'release', 'list', '--today', '2026-10-20']).data;
  const check = cli.run(['backlog', 'check']).data;
  if (!check.ok) throw new Error(`backlog check reported problems: ${JSON.stringify(check.problems)}`);
  return { tree, board, releases, readiness, check };
}

/** @typedef {ReturnType<typeof buildBacklog>} BacklogSummary */

/** @param {string} path */
const link = path => `[${path}](<${path}>)`;

/** @param {{ title: string, displayType: string, state: string | null, rank: number, items: any[] }[]} nodes @param {number} depth @returns {string[]} */
function treeLines(nodes, depth = 0) {
  return nodes.flatMap(node => [
    `${'  '.repeat(depth)}- ${node.displayType} ${node.title}${node.state ? ` · ${node.state}` : ''} · rank ${node.rank}`,
    ...treeLines(node.items, depth + 1),
  ]);
}

/** The README section that records the backlog reports. @param {BacklogSummary} summary */
export function backlogSection(summary) {
  const columns = summary.board.columns.map((/** @type {any} */ column) => `| ${column.state ?? '(no state)'} | ${column.count} | ${column.limit ?? ''} | ${column.cards.map((/** @type {any} */ card) => card.title).join(', ')} |`);
  const releases = summary.releases.releases.map((/** @type {any} */ row) => `| ${row.name} | ${row.version.value} | ${row.target.value} | ${row.status.value} | ${row.released.value ?? ''} | ${row.members.value} | ${row.done.value} |`);
  const criteria = summary.readiness.criteria.map((/** @type {any} */ criterion) => `- \`${criterion.key}\`: ${criterion.verdict}${criterion.outstandingPaths?.length ? ` (outstanding: ${criterion.outstandingPaths.map((/** @type {string} */ path) => `\`${path}\``).join(', ')})` : ''}`);
  return [
    `The \`backlog\` core plugin built ${link(backlogPaths.base)} and every note under \`${backlogPaths.folder}\`. The notes open unchanged in the Obsidian Product Backlog view (backlog-view): the base's view options are the configuration, \`order\` is one global rank, and states, stamps, iterations, releases and dependencies are plain frontmatter.`,
    '',
    '### Hierarchy (`backlog tree`)',
    '',
    ...treeLines(summary.tree.roots),
    '',
    '### Board (`backlog board`)',
    '',
    '| Column | Items | WIP limit | Cards |',
    '| --- | --- | --- | --- |',
    ...columns,
    '',
    '### Releases (`backlog release list`)',
    '',
    '| Release | Version | Target | Status | Released | Members | Done |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...releases,
    '',
    `Readiness of ${backlogPaths.release} (\`backlog release readiness\`), ${summary.readiness.members} direct members:`,
    '',
    ...criteria,
    '',
    `\`backlog release notes\` generated ${link(backlogPaths.notes)}. \`backlog check\` reports ${summary.check.counts.errors} errors and ${summary.check.counts.warnings} warnings over ${summary.check.counts.items} items.`,
    '',
  ].join('\n');
}
