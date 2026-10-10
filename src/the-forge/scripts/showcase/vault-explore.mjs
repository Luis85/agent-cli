const buildLogTitle = 'Build log';

/** What the showcase asks of its finished vault with the `search` and `links` core plugins. */
const explorations = {
  search: ['search', 'REQ-004', '--kind', 'markdown', '--path', 'docs/**', '--in', 'body'],
  backlinks: ['links', 'back', 'docs/product/Trailhead PRD.md'],
  unresolved: ['links', 'unresolved'],
  orphans: ['links', 'orphans', '--path', 'docs/**'],
};

/**
 * @typedef {{ path: string, line: number, column: number, snippet: string }} Hit
 * @typedef {{ source: string, kind: string, line?: number, key?: string, node?: string, original: string, reason?: string, candidates?: string[] }} Link
 * @typedef {{ hits: Hit[], total: number, backlinks: Link[], unresolved: Link[], orphans: string[] }} Exploration
 */

/**
 * Read-only queries over the finished vault: a text search and three link reports. They run concurrently, like
 * the Bases queries, and their results are written into the README.
 * @param {import('./cli.mjs').ForgeCli} cli
 * @returns {Promise<Exploration>}
 */
export async function exploreVault(cli) {
  cli.begin('Search and links');
  const [search, back, unresolved, orphans] = await cli.runConcurrently([explorations.search, explorations.backlinks, explorations.unresolved, explorations.orphans]);
  return { hits: search.data.hits, total: search.data.total, backlinks: back.data.backlinks, unresolved: unresolved.data.links, orphans: orphans.data.files };
}

/** @param {string[]} args */
const command = args => `node bin/forge.js ${args.map(arg => /^[\w./=-]+$/.test(arg) ? arg : `'${arg}'`).join(' ')}`;
/** @param {Link} link */
const where = link => link.line !== undefined ? `line ${link.line}` : link.key !== undefined ? `property \`${link.key}\`` : `Canvas node \`${link.node}\``;
/** @param {string} title @param {string[]} args @param {string} summary @param {string[]} items */
const section = (title, args, summary, items) => [`### ${title}`, '', '```sh', command(args), '```', '', summary, '', ...items, ''].join('\n');

/** @param {Link[]} links */
function unresolvedSummary(links) {
  if (links.length === 0) return 'None: every link in the vault resolves to exactly one file.';
  // The build log records every command, so generation writes it after these reports.
  if (links.every(link => link.original === `[[${buildLogTitle}]]`)) return `Only the hub's link to the build log, which generation writes after these reports; in the committed vault \`links unresolved\` reports none:`;
  return `${links.length} unresolved link${links.length === 1 ? '' : 's'}:`;
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
  ].join('\n');
}
