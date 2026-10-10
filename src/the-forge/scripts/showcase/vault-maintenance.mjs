/**
 * Restructuring the vault the way Obsidian does, without breaking the knowledge graph: one note is renamed with
 * every wikilink, frontmatter link and Canvas node updated in the same batch, a scratch note goes to the trash, a
 * multi-file plan is previewed with `apply --dry-run`, and one section of the release plan is extended in place.
 */
export const maintenance = {
  renamed: {
    from: 'docs/delivery/Trip planner test plan.md',
    name: 'Trip planner verification plan',
    to: 'docs/delivery/Trip planner verification plan.md',
  },
  scratch: 'docs/scratch/Packing ideas.md',
  trashed: '.trash/docs/scratch/Packing ideas.md',
  /** A section edit that records an open decision in the release plan. */
  decision: {
    path: 'docs/delivery/Trailhead 1.0 release plan.md',
    section: 'Trailhead 1.0 release plan > Uncertainties and decisions',
    content: '\n- Open: whether UC-003 (offline trail guides) ships in 1.0 or is deferred; owner: Trailhead product team.',
  },
  /** A plan previewed with `apply --dry-run` and never committed: deferring UC-003 out of the 1.0 scope. */
  deferral: {
    from: 'docs/use-cases/UC-003 Browse trail guides.md',
    to: 'docs/use-cases/deferred/UC-003 Browse trail guides.md',
  },
};

/**
 * Preview a multi-file plan as one guarded batch without writing it: a frontmatter change and a move whose link
 * rewriting reaches the notes, Bases and Canvas that name the use case. Generation fails unless the dry run plans
 * every operation, rewrites links and leaves the use case where it is.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
function previewDeferral(cli) {
  const { from, to } = maintenance.deferral;
  const before = cli.run(['read', from], { record: false }).data.revision;
  const plan = { version: 1, operations: [
    { op: 'frontmatter', path: from, set: { status: 'deferred' }, ifMatch: before },
    { op: 'move', from, to },
  ] };
  const preview = cli.run(['apply', '-', '--dry-run'], { input: `${JSON.stringify(plan, null, 2)}\n` });
  const moved = preview.data.operations[1];
  if (preview.data.dryRun !== true || moved?.to !== to || moved.links.updated === 0 || moved.links.unrewritten.length > 0) throw new Error(`apply --dry-run did not plan the deferral of ${from}`);
  if (cli.run(['read', from], { record: false }).data.revision !== before) throw new Error(`apply --dry-run changed ${from}`);
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
  previewDeferral(cli);
  const { path, section, content } = maintenance.decision;
  cli.guarded(path, ['edit', path, '--section', section, '--append', '--content', content]);
}
