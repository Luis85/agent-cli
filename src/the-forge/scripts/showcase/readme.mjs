import { agentsSection, agentTeam } from './agents.mjs';
import { workflowPath } from './code.mjs';
import { uiTargets } from './design-system.mjs';
import { dataOutputs } from './data.mjs';
import { project } from './project.mjs';
import { vaultPaths } from './vault.mjs';
import { maintenance } from './vault-maintenance.mjs';
import { explorationSection } from './vault-explore.mjs';
import { backlogPaths, backlogSection } from './backlog.mjs';
import { syncSection } from './sync.mjs';
import { native, nativeSection } from './native.mjs';
import { exchangeSection } from './exchange.mjs';
import { contractSection } from './contract.mjs';

export const buildLogPath = 'docs/Build log.md';

/** @param {string} path */
const link = path => `[${path}](<${path}>)`;

const folders = [
  ['docs/product, docs/use-cases, docs/design, docs/delivery', 'PRD, three use cases, design, build spec, implementation, test and release plans rendered from the workflow templates, then linked with guarded `properties` and `edit` changes', '`templates install workflow`, `make document --template workflow/<kind>.md --date`, `properties --set`, `edit --find/--replace`, `edit --append`'],
  [vaultPaths.hub, 'Hub note that links the whole knowledge graph and embeds a Bases view', '`create`'],
  [vaultPaths.canvas, 'JSON Canvas architecture map with file nodes, groups and labelled edges', '`create`, `patch --pointer /nodes` and `/edges` (replace), `/nodes/-` and `/edges/-` (append), `validate`'],
  ['docs/bases', 'Native Bases views: documents by stage, requirement traceability and library backlinks', '`create`, `validate`, `bases list`, `bases inspect`, `bases query`'],
  ['docs', 'Full-text search, link reports and tag and property inventories over the finished knowledge graph, recorded below', '`search`, `links back`, `links out`, `links unresolved`, `links orphans`, `links deadends`, `vault tags`, `vault properties`, `vault check`'],
  [backlogPaths.folder, 'Product backlog compatible with the Obsidian Product Backlog view: Epics, Features, PBIs, a Bug and Tasks with ranks, states and stamps, assignees, dependencies, an iteration, two releases with readiness and generated release notes, and a sync base with two views bound to two Azure DevOps connections', '`backlog init`, `write --if-match`, `backlog add`, `backlog move`, `backlog set`, `backlog depend`, `backlog iteration add/assign`, `backlog release add/join/mark-released/readiness/notes`, `backlog check`, `create`, `connectors list`, `backlog sync --dry-run`'],
  [maintenance.renamed.to, 'Generated as "Trip planner test plan", then renamed: every wikilink, frontmatter link and the Canvas file node that named it were rewritten in the same guarded batch', '`rename --dry-run`, `rename --if-match`'],
  [maintenance.trashed, 'A scratch note deleted the Obsidian way: moved to the vault trash, which Obsidian and the metadata cache ignore', '`create`, `delete --if-match`'],
  [maintenance.deferral.to, 'Moved out of the 1.0 scope with every wikilink, frontmatter link and Canvas node rewritten; its status set by the committed `apply` plan and its body changed by two literal edits in one call', '`move --dry-run`, `move --if-match`, `apply -`, `edit --edits`'],
  [maintenance.decision.path, 'The open UC-003 question recorded as a list item with the block id `^uc-003-scope`, decided by an `apply` plan that changed it and the use case\'s status in one guarded batch (previewed first), then extended through its block id, with a scope note prepended to another section', '`edit --section --append`, `apply - --dry-run`, `apply -`, `edit --block --append`, `edit --section --prepend`'],
  ['library/components', 'Starter component library plus the Trailhead `trip-card` and `trip-planner` definitions', '`components init`, `components create`, `write --if-match`, `components validate`'],
  ['library/interactions', 'Starter interactions plus `toggle-favorite`, `capture-destination` and `save-trip-draft`', '`interactions init`, `interactions create`, `write --if-match`, `interactions validate`'],
  ['library/data-sources', 'REST (`trips-api`) and local JSON (`trail-guides`) data-source definitions', '`data-sources create`, `write --if-match`, `data-sources validate`'],
  [`ui/{${uiTargets.join(',')}}`, 'Generated UI components and Storybook CSF stories for all seven targets, checked for drift', '`make ui trip-planner --framework <target> --stories` into the default `ui/<target>/components` and `ui/<target>/stories`, `make ui ... --check`'],
  ['src/domain, src/application', 'Domain entity, value object and event; application use cases with injected ports', '`project component`, `make entity`, `make value-object`, `make event`, `make use-case`'],
  ['src/presentation/forms', 'Typed Zod forms rendered by the Vite form preview (`npm run dev`)', '`project create`, `make form TripRequest`'],
  [`${dataOutputs.adapters}, ${dataOutputs.fixtures}`, 'Typed adapters and deterministic fixtures generated from the data-source definitions', '`make data-source`, `make data-source --check`'],
  [workflowPath, "The project's own CI workflow on Node 22.12 and 24: install, check and test from this directory. The workspace's `workflows sync` generates its `.github/workflows/forge-showcase--check.yml` entrypoint", '`create`, `workflows list`'],
  ['tests', 'Generated tests plus authored adapter, model and knowledge-graph tests run by this project\'s Vitest', '`project create`, `project component`, `make form`, `create`'],
  [agentTeam.file, 'docker-agent team: a lead with two sub-agents, a GitHub MCP toolset and a `/trace` command, authored with comments and completed with `agents create`', '`create`, `agents create --if-match`, `edit`, `agents validate`, `agents list`'],
  ['.claude/agents', 'Claude Code agents generated from the team with provenance, plus a native reviewer agent', '`agents generate --target claude --commands --mcp inline` (`--plan`, `--check`), `claude agents create`, `claude agents list`'],
  ['.claude/skills', 'The team\'s `/trace` command as a Claude skill, plus the Forge process skills as Agent Skills folders for Claude Code', '`agents generate --commands`, `skills install`'],
  ['.agents/skills', 'The same Forge process skills for other agents that read the cross-agent `.agents/skills` root', '`skills install`'],
  ['.claude/settings.json', 'A project `PostToolUse` hook that runs the structure check after Claude edits a file', '`claude hooks set`, `claude hooks check`'],
  [native.plugin, 'A local Claude Code plugin with a `/trace` command, checked structurally', '`claude plugins create`, `claude plugins write-asset`, `claude plugins check`'],
  ['.exchange', 'Data-source definitions exported for another workspace, in a hidden folder outside the vault', '`data-sources export`, `data-sources import --dry-run`'],
  ['src/index.ts', 'Library public API exporting the Trailhead model, form and adapters', '`write --if-match`'],
  ['package.json, configs, scripts', 'Independent toolchain from `project create`: structure, Oxlint, fallow, TypeScript, Vite and Vitest. Its checks skip `ui/`, whose framework sources belong to downstream applications', '`project create`'],
];

/**
 * @param {{
 *   queries: { base: string, view: string, files: string[], total: number }[],
 *   exploration: import('./vault-explore.mjs').Exploration,
 *   backlog: import('./backlog.mjs').BacklogSummary,
 *   sync: import('./sync.mjs').SyncSummary,
 *   agents: Parameters<typeof agentsSection>[0],
 *   native: import('./native.mjs').NativeSummary,
 *   exchange: import('./exchange.mjs').ExchangeSummary,
 *   contract: import('./contract.mjs').Contract,
 * }} results
 */
export function readme({ queries, exploration, backlog, sync, agents, native: nativeSummary, exchange, contract }) {
  const results = queries.map(query => [
    `### ${query.view} (\`${query.base}\`)`,
    '',
    '```sh',
    `node bin/forge.js bases query '${query.base}' --view '${query.view}'`,
    '```',
    '',
    `${query.total} matching file${query.total === 1 ? '' : 's'}:`,
    '',
    ...query.files.map(file => `- ${link(file)}`),
    '',
  ].join('\n')).join('\n');
  return `# Trailhead: The Forge showcase

Trailhead is a small fictional trip-planning web app for hiking groups. This managed Forge project shows The Forge's capabilities end to end: an Obsidian-compatible knowledge graph of specs and docs, Canvas and Bases, a product backlog compatible with the Obsidian Product Backlog view, a component library with interactions generated for all seven UI targets with Storybook stories, data sources with typed adapters and fixtures, domain and application code, forms, Claude Code agents generated from a docker-agent team, agent skills and the project's own CI workflow.

Everything here is generated by the bundled CLI. The Forge project's \`scripts/showcase.mjs\` (in \`src/the-forge\`) drives \`node bin/forge.js\` with fixed inputs and the fixed date ${project.date}, so regeneration is byte-for-byte reproducible. Do not edit generated files by hand; change the script and regenerate.

## Browse, regenerate and verify

- **Obsidian:** open \`${project.directory}\` as a vault and start at ${link(vaultPaths.hub)}. Opening the whole repository as a vault also works, but Canvas file paths are relative to this project folder.
- **Regenerate** from \`src/the-forge\`: \`npm run showcase\`. **Check drift:** \`npm run showcase:check\` regenerates into a temporary workspace and lists differing paths.
- **Project checks** from this directory: \`npm ci\`, then \`npm run check\` and \`npm test\`. The committed \`package-lock.json\` is refreshed only by \`npm run showcase -- --lockfile\`.
- **Forge commands** run from the repository root. File commands need this project selected (\`node bin/forge.js project open ${project.id}\`); restore the checkout's selection afterwards with \`node bin/forge.js project open the-forge\`. UI and data-source generation accept \`--project ${project.id}\` without changing the selection.

## What each folder demonstrates

| Path | Demonstrates | Produced by |
| --- | --- | --- |
${folders.map(([path, what, how]) => `| \`${path}\` | ${what} | ${how} |`).join('\n')}

Every command, in order, is recorded in ${link(buildLogPath)}.

## Bases query results

These results were produced by \`bases query\` during generation, with \`${project.id}\` selected and without Obsidian.

${results}
## Search and link reports

The \`search\`, \`links\` and \`vault-check\` core plugins read the same vault through the metadata cache. These read-only reports ran during generation, after the vault was built and restructured.

${explorationSection(exploration)}## Product backlog

${backlogSection(backlog)}
## Backlog sync

${syncSection(sync)}
${agentsSection(agents)}
${nativeSection(nativeSummary)}
${exchangeSection(exchange)}
${contractSection(contract)}`;
}

/** @param {{ section: string, command: string }[]} log */
export function buildLog(log) {
  /** @type {Map<string, string[]>} */
  const sections = new Map();
  for (const entry of log) sections.set(entry.section, [...(sections.get(entry.section) ?? []), entry.command]);
  const body = [...sections].map(([section, commands]) => `## ${section}\n\n\`\`\`sh\n${commands.join('\n')}\n\`\`\`\n`).join('\n');
  return `---
type: log
tags: [trailhead, forge]
hub: "[[Trailhead]]"
---
# Build log

Every Forge CLI invocation the showcase script made to build this project, in order. Long JSON values and Markdown inputs are abbreviated; \`< input\` marks content passed on standard input, and \`<revision>\` the SHA-256 revision read before a guarded change. The script runs these commands in a temporary workspace with \`--root\` and \`--json\`, then copies \`${project.directory}\` into the repository. See [[Trailhead]] for the product hub.

${body}`;
}
