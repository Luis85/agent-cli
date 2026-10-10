import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vaultCommand } from '../support/vault-check.ts';
import { workspaceRoot } from '../support/workspace.ts';

/**
 * The Forge project as an Obsidian vault: the README, the Diátaxis docs (with the worked examples and authored
 * templates), the authored skills and every other Markdown file, checked from the project root as
 * `node bin/forge.js vault check --strict` checks it with `the-forge` selected, using the checkout's tracked
 * `plugins.settings.vault-check` from the workspace `bin/config.json`, so the test and the command cannot drift.
 * Its ignore globs are relative to the selected project, as documented in docs/how-to/develop-and-test.md:
 * `src/README.md` and `tests/README.md` link folders for GitHub navigation, which Obsidian cannot resolve; `tests/`
 * holds fixture vaults with deliberate broken links; and `evals/fixtures/` is the agent evaluation vault, whose
 * unresolved link and orphan note are what its tasks ask agents to repair.
 */
const checkoutSettings = async () => JSON.parse(await readFile(join(workspaceRoot, 'bin/config.json'), 'utf8')).plugins.settings as Record<string, unknown>;

it('keeps The Forge documentation vault free of error findings under the checkout configuration', async () => {
  const settings = await checkoutSettings();
  expect(settings['vault-check']).toEqual({ ignore: ['src/README.md', 'tests/**', 'evals/fixtures/**'] });
  const { check } = await vaultCommand(process.cwd(), settings);
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
