/**
 * Restructuring the vault the way Obsidian does, without breaking the knowledge graph: one note is renamed with
 * every wikilink, frontmatter link and Canvas node updated in the same batch, and a scratch note goes to the trash.
 */
export const maintenance = {
  renamed: {
    from: 'docs/delivery/Trip planner test plan.md',
    name: 'Trip planner verification plan',
    to: 'docs/delivery/Trip planner verification plan.md',
  },
  scratch: 'docs/scratch/Packing ideas.md',
  trashed: '.trash/docs/scratch/Packing ideas.md',
};

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
}
