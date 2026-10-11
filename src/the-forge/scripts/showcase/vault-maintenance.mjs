/**
 * Restructuring the vault the way Obsidian does, without breaking the knowledge graph: one note is renamed and one
 * moved with every wikilink, frontmatter link and Canvas node updated in the same batch, a scratch note goes to the
 * trash, and deferring UC-003 is recorded with a committed `apply` plan and precise edits of blocks, sections and
 * literal text.
 */
const releasePlan = 'docs/delivery/Trailhead 1.0 release plan.md';

export const maintenance = {
  renamed: {
    from: 'docs/delivery/Trip planner test plan.md',
    name: 'Trip planner verification plan',
    to: 'docs/delivery/Trip planner verification plan.md',
  },
  scratch: 'docs/scratch/Packing ideas.md',
  trashed: '.trash/docs/scratch/Packing ideas.md',
  /** The open scope question, recorded as a list item with a block id so later edits can address it. */
  decision: {
    path: releasePlan,
    section: 'Trailhead 1.0 release plan > Uncertainties and decisions',
    block: 'uc-003-scope',
    open: '- Open: whether UC-003 (offline trail guides) ships in 1.0 or is deferred; owner: Trailhead product team.',
    decided: '- Decided: UC-003 (offline trail guides) is deferred until after 1.0; owner: Trailhead product team.',
    followUp: '- Follow-up: plan offline trail guides for Trailhead 1.1 once the trip planner ships.',
  },
  /** UC-003 moves out of the 1.0 scope; the move rewrites every link to it. */
  deferral: {
    from: 'docs/use-cases/UC-003 Browse trail guides.md',
    to: 'docs/use-cases/deferred/UC-003 Browse trail guides.md',
  },
  /** The scope section of the release plan, which gets a note in front of its content. */
  scope: {
    section: 'Trailhead 1.0 release plan > Scope and release identity',
    note: 'Scope note: UC-003 [[UC-003 Browse trail guides]] is deferred to a later release; see the decisions below.\n\n',
  },
};

/** @param {import('./cli.mjs').ForgeCli} cli @param {string} path */
const readRevision = (cli, path) => cli.run(['read', path], { record: false }).data.revision;

/**
 * Move UC-003 out of the release scope. The dry run lists a diff for every note, Base and Canvas whose links change
 * and the revision that guards the move; generation fails unless the move rewrites links and leaves none behind.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
function deferUseCase(cli) {
  const { from, to } = maintenance.deferral;
  const preview = cli.run(['move', from, to, '--dry-run']);
  const moved = cli.run(['move', from, to, '--if-match', preview.data.revision]);
  if (moved.data.to !== to || moved.data.links.updated === 0 || moved.data.links.unrewritten.length > 0) throw new Error(`move ${from} did not update every link`);
}

/**
 * Record the deferral with one `apply` plan: the use case's frontmatter status and the decision in the release
 * plan change together or not at all. The plan is previewed, then committed with the same revision guards.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
function recordDeferral(cli) {
  const { to } = maintenance.deferral;
  const { path, open, decided } = maintenance.decision;
  const plan = { version: 1, operations: [
    { op: 'frontmatter', path: to, set: { status: 'deferred' }, ifMatch: readRevision(cli, to) },
    { op: 'edit', path, edits: [{ find: open, replace: decided }], ifMatch: readRevision(cli, path) },
  ] };
  const input = `${JSON.stringify(plan, null, 2)}\n`;
  const preview = cli.run(['apply', '-', '--dry-run'], { input });
  if (preview.data.dryRun !== true || preview.data.operations.length !== 2) throw new Error('apply --dry-run did not plan the deferral');
  const committed = cli.run(['apply', '-'], { input });
  if (committed.data.dryRun !== false || committed.data.changes.length !== 2) throw new Error('apply did not commit the deferral');
}

/**
 * Precise edits: several literal replacements in one guarded call, content appended to a block and content
 * prepended to a section.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
function editPrecisely(cli) {
  const { to } = maintenance.deferral;
  const { path, block, followUp } = maintenance.decision;
  const edits = [
    { find: 'Use case ID: UC-003. Status: accepted.', replace: 'Use case ID: UC-003. Status: deferred.' },
    { find: 'Execution evidence: not collected.', replace: 'Execution evidence: not collected; deferred until after Trailhead 1.0.' },
  ];
  cli.guarded(to, ['edit', to, '--edits', JSON.stringify(edits)]);
  cli.guarded(path, ['edit', path, '--block', block, '--append', '--content', followUp]);
  cli.guarded(path, ['edit', path, '--section', maintenance.scope.section, '--prepend', '--content', maintenance.scope.note]);
}

/** @param {import('./cli.mjs').ForgeCli} cli */
export function maintainVault(cli) {
  cli.begin('Vault maintenance');
  const { from, name, to } = maintenance.renamed;
  // The dry run lists a diff for every note and Canvas whose links change, and the revision to guard the rename.
  const preview = cli.run(['rename', from, name, '--dry-run']);
  const renamed = cli.run(['rename', from, name, '--if-match', preview.data.revision]);
  if (renamed.data.to !== to || renamed.data.links.unrewritten.length > 0) throw new Error(`rename ${from} did not update every link`);
  cli.create(maintenance.scratch, '# Packing ideas\n\nA scratch list, discarded once the packing checklist moved into the verification plan.\n');
  const deleted = cli.guarded(maintenance.scratch, ['delete', maintenance.scratch]);
  if (deleted.data.trashPath !== maintenance.trashed) throw new Error(`delete moved ${maintenance.scratch} to ${deleted.data.trashPath}`);
  const { path, section, block, open } = maintenance.decision;
  cli.guarded(path, ['edit', path, '--section', section, '--append', '--content', `\n${open} ^${block}`]);
  deferUseCase(cli);
  recordDeferral(cli);
  editPrecisely(cli);
}
