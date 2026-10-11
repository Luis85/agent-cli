const buildLogTitle = 'Build log';

/** What the showcase asks of its finished vault with the `search` and `links` core plugins. */
const explorations = {
  search: ['search', 'REQ-004', '--kind', 'markdown', '--path', 'docs/**', '--in', 'body'],
  backlinks: ['links', 'back', 'docs/product/Trailhead PRD.md'],
  unresolved: ['links', 'unresolved'],
  orphans: ['links', 'orphans', '--path', 'docs/**'],
  outgoing: ['links', 'out', 'docs/Trailhead.md'],
  deadEnds: ['links', 'deadends', '--path', 'docs/**'],
  tags: ['vault', 'tags'],
  properties: ['vault', 'properties'],
};

/** The final verification of the finished project: no `vault check` finding of severity error. */
const verification = ['vault', 'check', '--strict'];

/**
 * Record the verification in the build log before the log and README are written, so it can check them too.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
export function planVerification(cli) {
  cli.begin('Verification');
  cli.record(verification);
}

/**
 * Run the recorded verification over the finished project; generation fails on any error finding.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
export function verifyVault(cli) {
  cli.run(verification, { record: false });
}

/**
 * @typedef {{ path: string, line: number, column: number, snippet: string }} Hit
 * @typedef {{ source: string, kind: string, line?: number, key?: string, node?: string, original: string, reason?: string, candidates?: string[] }} Link
 * @typedef {{ tag: string, count: number }} Tag
 * @typedef {{ name: string, count: number, type: string, conflicting: boolean }} Property
 * @typedef {{ hits: Hit[], total: number, backlinks: Link[], unresolved: Link[], orphans: string[], outgoing: (Link & { status: string, target?: string })[], deadEnds: string[], tags: Tag[], properties: Property[] }} Exploration
 */

/**
 * Read-only queries over the finished vault: a text search, link reports and the tag and property inventories.
 * They run concurrently, like the Bases queries, and their results are written into the README.
 * @param {import('./cli.mjs').ForgeCli} cli
 * @returns {Promise<Exploration>}
 */
export async function exploreVault(cli) {
  cli.begin('Search and links');
  const [search, back, unresolved, orphans, outgoing, deadEnds, tags, properties] = await cli.runConcurrently([
    explorations.search, explorations.backlinks, explorations.unresolved, explorations.orphans,
    explorations.outgoing, explorations.deadEnds, explorations.tags, explorations.properties,
  ]);
  return {
    hits: search.data.hits, total: search.data.total, backlinks: back.data.backlinks, unresolved: unresolved.data.links, orphans: orphans.data.files,
    outgoing: outgoing.data.links, deadEnds: deadEnds.data.files, tags: tags.data.tags, properties: properties.data.properties,
  };
}

/** @param {string[]} args */
const command = args => `node bin/forge.js ${args.map(arg => /^[\w./=-]+$/.test(arg) ? arg : `'${arg}'`).join(' ')}`;
/** @param {Link} link */
const where = link => link.line !== undefined ? `line ${link.line}` : link.key !== undefined ? `property \`${link.key}\`` : `Canvas node \`${link.node}\``;
/** @param {string} title @param {string[]} args @param {string} summary @param {string[]} items */
const section = (title, args, summary, items) => [`### ${title}`, '', '```sh', command(args), '```', '', summary, ...(items.length > 0 ? ['', ...items] : []), ''].join('\n');

/** @param {Link[]} links */
function unresolvedSummary(links) {
  if (links.length === 0) return 'None: every link in the vault resolves to exactly one file.';
  // The build log records every command, so generation writes it after these reports.
  if (links.every(link => link.original === `[[${buildLogTitle}]]`)) return `Only the hub's link to the build log, which generation writes after these reports; in the committed vault \`links unresolved\` reports none:`;
  return `${links.length} unresolved link${links.length === 1 ? '' : 's'}:`;
}

/** @param {Exploration['outgoing']} links */
function outgoingSummary(links) {
  const unresolved = links.filter(link => link.status !== 'resolved');
  if (unresolved.length === 0) return '; each resolves to a file';
  // The build log records every command, so generation writes it after these reports.
  if (unresolved.every(link => link.original === `[[${buildLogTitle}]]`)) return '; all resolve except the build log, which generation writes after these reports';
  return `; ${unresolved.length} do not resolve`;
}

/** The README section that records the search and link reports. @param {Exploration} result */
export function explorationSection(result) {
  const count = (/** @type {number} */ n, /** @type {string} */ noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return [
    section('Search', explorations.search, `${count(result.total, 'hit')} in note bodies, ordered by path, line and column; each hit also carries the file's revision for a guarded \`edit\`:`,
      result.hits.map(hit => `- \`${hit.path}:${hit.line}:${hit.column}\`: \`\` ${hit.snippet} \`\``)),
    section('Backlinks', explorations.backlinks, `${count(result.backlinks.length, 'reference')} to the PRD, including frontmatter links and Canvas file nodes:`,
      result.backlinks.map(link => `- \`${link.source}\`, ${where(link)}: \`${link.original}\``)),
    section('Unresolved links', explorations.unresolved, unresolvedSummary(result.unresolved),
      result.unresolved.map(link => `- \`${link.source}\`, ${where(link)}: \`${link.original}\` (${link.reason}${link.candidates ? `: ${link.candidates.join(', ')}` : ''})`)),
    section('Orphaned documents', explorations.orphans, result.orphans.length === 0 ? 'None: every document under `docs` is linked from another file.' : `${count(result.orphans.length, 'document')} under \`docs\` that no other file links to:`,
      result.orphans.map(path => `- \`${path}\``)),
    section('Outgoing links', explorations.outgoing, `The hub note has ${count(result.outgoing.length, 'link')} in its body and frontmatter${outgoingSummary(result.outgoing)}:`,
      result.outgoing.map(link => `- \`${link.original}\` → ${link.target ? `\`${link.target}\`` : link.status}`)),
    section('Dead ends', explorations.deadEnds, result.deadEnds.length === 0 ? 'None: every document under `docs` links to another file.' : `${count(result.deadEnds.length, 'document')} under \`docs\` without outgoing links:`,
      result.deadEnds.map(path => `- \`${path}\``)),
    section('Tags', explorations.tags, `${count(result.tags.length, 'tag')} across frontmatter and note bodies, with their file counts:`,
      [result.tags.map(tag => `\`${tag.tag}\` (${tag.count})`).join(', ')]),
    section('Properties', explorations.properties, `${result.properties.length} frontmatter properties with the type inferred from their values${result.properties.some(property => property.conflicting) ? '; conflicting types are marked' : ''}:`,
      ['| Property | Type | Files |', '| --- | --- | --- |', ...result.properties.map(property => `| \`${property.name}\` | ${property.type}${property.conflicting ? ' (conflicting)' : ''} | ${property.count} |`)]),
    section('Vault check', verification, 'The `vault-check` core plugin runs last, after this README and the build log are written. Generation fails unless it passes, so the project has no broken link or embed, unparseable note and invalid Canvas or Base; warnings, such as conflicting property types, would not fail it.', []),
  ].join('\n') + '\n';
}
