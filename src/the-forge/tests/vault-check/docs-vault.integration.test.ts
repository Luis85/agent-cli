import { expect, it } from 'vitest';
import { vaultCommand } from '../support/vault-check.ts';

/**
 * The Forge project as an Obsidian vault: the README, the Diátaxis docs (with the worked examples and authored
 * templates), the authored skills and every other Markdown file, checked from the project root as
 * `vault check --strict` with these `plugins.settings.vault-check.ignore` globs would be. Excluded, as documented in
 * docs/how-to/develop-and-test.md: `src/README.md` and `tests/README.md` link folders for GitHub navigation, which
 * Obsidian cannot resolve; `tests/` holds fixture vaults with deliberate broken links; and `evals/fixtures/` is the
 * agent evaluation vault, whose unresolved link and orphan note are what its tasks ask agents to repair.
 */
const exclusions = ['src/README.md', 'tests/**', 'evals/fixtures/**'];

it('keeps The Forge documentation vault free of error findings', async () => {
  const { check } = await vaultCommand(process.cwd(), { 'vault-check': { ignore: exclusions } });
  const result = await check({ strict: true });
  expect(result.summary.error).toBe(0);
  expect(result.summary.files).toBeGreaterThan(70);
  expect(result.skipped).toEqual([]);
  const documentation = await check({ path: '{README.md,docs/**,skills/**}', strict: true });
  expect(documentation.summary.files).toBeGreaterThan(70);
});

it('excludes the evaluation fixture vault because its broken link is deliberate', async () => {
  const { check } = await vaultCommand(process.cwd());
  const fixture = await check({ path: 'evals/fixtures/**' });
  expect(fixture.findings).toContainEqual(expect.objectContaining({ rule: 'unresolved-link', severity: 'error', path: 'evals/fixtures/vault/Projects/Beta.md' }));
});
