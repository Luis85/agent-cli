# Mutation testing, iteration 2

Planned 2026-10-15 on top of PR #29 (`claude/next-iteration` at `2b24834`). Maintainer material, not packaged into `bin/data/docs`; it does not define runtime contracts. The [develop and test guide](../how-to/develop-and-test.md#mutation-testing) remains the reference for running mutation tests.

## Starting point

Three read-only scouts measured the current setup before any change.

**Baseline.** A forced full run reproduced the documented score exactly:

- **81.51%** overall, 84.80% of covered mutants.
- 7,124 mutants: 5,286 killed, 69 timed out, 960 survived, 255 without coverage and 554 static mutants ignored.
- 23 minutes on four cores, under load from the other scouts.

All 1,215 survived and uncovered mutants were classified: 943 point at a missing test, 270 are likely equivalent and 2 look like defects. The survivors concentrate in:

| File | Score | Survived | No coverage |
| --- | --- | --- | --- |
| backlog `writes.ts` | 70.9% | 84 | 46 |
| backlog `ranks.ts` | 65.2% | 73 | 50 |
| Azure DevOps `work-items.ts` | 74.0% | 79 | 23 |
| backlog `fields.ts` | 70.8% | 67 | 26 |
| backlog `check.ts` | 57.3% | 33 | 37 |
| backlog `notes.ts` | 75.3% | 44 | 26 |
| agents `claude-merge.ts` | 69.2% | 65 | 3 |
| backlog `sync-fields.ts` | 75.5% | 51 | 14 |
| `link-resolution.ts` | 82.5% | 52 | 3 |
| Azure DevOps `markdown-html.ts` | 72.4% | 48 | 0 |
| agents `references.ts` | 71.5% | 45 | 2 |
| backlog `board.ts` | 65.2% | 28 | 3 |

Two patterns recur:

- `toEqual` ignores keys whose value is `undefined`, so a mutant that writes `key: undefined` passes. Many `writes.ts` survivors need `toStrictEqual`.
- Error messages and details are often never asserted.

**Suspected defects.** Reproducing the suspicious survivors, and reading the code around them, found five defects. Each was confirmed by running the source directly.

| # | Location | Input → observed output |
| --- | --- | --- |
| S1 | `markdown-html.ts` heading rule | `# C#` → `<h1>C</h1>`: a closing `#` run is stripped without a space before it |
| S2 | `markdown-html.ts` fence rule | Any line that starts with three backticks closes a block, even one with an info string, and a 4-backtick fence closes at an inner 3-backtick line, so code leaks into a paragraph |
| S3 | `markdown-html.ts` link rule | `[x](https://en.wikipedia.org/wiki/Foo_(bar))` ends the target at the first `)` |
| S4 | backlog `notes.ts` `FENCE` | The fence pattern misses empty and indented fences, so code blocks pair wrongly. `withoutComments` then pushes an Obsidian `%%comment%%` to Azure DevOps, or strips a comment that sits inside code. This is a privacy leak. |
| S5 | backlog `fields.ts` dates | `Date.UTC` maps years 0–99 to 1900–1999: `readDate('0000-02-29')` is reported invalid. Low severity. |

**Next scope.** These pure modules have fast, focused unit tests and no sandbox hazards. Together they add about 2,100 mutants.

| Modules | Mutants (incl. static) | Unit tests |
| --- | --- | --- |
| `documents/{sections,blocks,text-edit}.ts` | 482 | `documents/{sections,blocks,text-files,apply-plan}` |
| `documents/path-glob.ts`, `shared/paging.ts` | 576 | `documents/listing`, `links/reports` |
| `metadata/link-text.ts`, `application/vault/link-plan.ts` | 564 | `vault/{link-updates,app}` |
| vault-check `domain/*.ts` | 509 | `vault-check/{rules,suggestion}` |
| `workflows/workflow.ts` | 122 | `workflows/workflow` |

Two changes come first:

- `vault-check/domain/suggestion.ts:15` (`counts[slot]!++`) makes Stryker's instrumenter throw and abort the whole run. Rewrite it as an assignment; behavior stays the same.
- `tests/workflows/workflow.unit.test.ts` builds its fixture at module level, so the fixture must move into the tests.

A second wave covers the Claude validators, the UI domain, the metadata snapshot, small validators and the agents mapping cluster. It is left for iteration 3.

**Toolchain.**

- **Upstream runner.** `@stryker-mutator/vitest-runner` 10.0.0 is still the latest, and upstream still joins test names with spaces. On `diff.ts` the official runner alone kills 0 of 268 mutants. The wrapper and a simulated upstream fix give identical results, so the wrapper costs no accuracy. *Keep it.*
- **TypeScript checker.** It made runs 2.7× to 6.5× slower, because checker processes take half the worker slots. 37% of mutants became compile errors, but 81% of those were already killed and only 59 were survivors. *Do not add it.*
- **Static mutants.** Each one re-runs only the tests related to its own file, so all 554 cost about 5 minutes, not the hour the guide claims. About 65% are killed. The survivors include real gaps, such as the Scrum process mappings. *Enable them for every file.*
- **CI caching.**
  - Only the weekly schedule seeds the default-branch cache.
  - A run that fails `thresholds.break` saves nothing, because the cache action saves only on success.
  - A re-run attempt reuses the same cache key.

## Decisions

- **Mutation testing runs in CI only.** It is not a local guardrail during development. `npm run check` stays as it is, and the guide presents `npm run mutate` as the CI entry point. Focused runs on one file remain available for investigating survivors.
- Enable static mutants (`ignoreStatic: false`).
- No TypeScript checker. Keep the `forge-vitest` wrapper.
- **Shard the CI run.**
  - Static mutants add about 5 minutes and wave 1 about 6–8, so one job would take more than 30 minutes against the 25-minute budget.
  - CI runs two shards in parallel. A deterministic partition of the files that `mutate` selects, balanced by size, assigns each file to a shard; each shard keeps its own incremental cache.
  - A merge job combines the shard reports and computes the overall score. It applies `thresholds.break` to that overall score and writes a per-file summary for the job. Shards never apply the threshold themselves.
  - Locally, `npm run mutate` still runs the whole scope in one process.
- **CI triggers and cache.**
  - Run on pushes to `main` as well, so the default-branch cache stays fresh.
  - Cancel superseded runs only on pull requests.
  - Restore and save the cache in separate steps, and save even when the score breaks the threshold.
  - Include the run attempt in the cache key.
  - Keep the weekly `--force` run.
  - The workflow stays advisory and is not a required check: its path filter would leave unrelated pull requests waiting.
- **Threshold.** After integration, set `thresholds.break` to floor(new score) − 3.

## Work areas

Each area runs in its own worktree and branch. Areas own disjoint source and test files. Area D alone edits `stryker.config.json`, the mutation workflow and the guide; the integrator adds the new `mutate` globs. No area commits `bin/**` or `src/forge-showcase/**`.

| Area | Goal | Owned files | Expected score |
| --- | --- | --- | --- |
| A. Backlog domain | Kill the survivors in the backlog domain and fix S5 | `src/plugins/backlog/domain/*` except `notes.ts`, plus `tests/backlog/*.unit.test.ts` except `notes.unit.test.ts` | `writes`, `ranks`, `fields`, `sync-fields`, `check`, `board` ≥ 85%; backlog overall ≥ 88% |
| B. Agents and Azure DevOps | Kill survivors in `claude-merge`, `references`, `claude-permissions`, `claude-rule-ownership`, `semantics`, `work-items` and `processes` (including the newly enabled static mutants) | those sources, `tests/agents/*.unit.test.ts`, and the Azure DevOps unit tests except the Markdown conversion tests | ≥ 85% each |
| C. Kernel documents and metadata | Mutate the kernel modules in wave 1 and kill survivors in `diff`, `apply-plan`, `literal-edit`, `link-resolution` and search `matching`/`query` | `src/domain/documents/*`, `src/domain/shared/paging.ts`, `src/domain/metadata/{link-resolution,link-text}.ts`, `src/application/vault/link-plan.ts`, `src/plugins/search/domain/*`, plus their unit tests | ≥ 85% for new files, ≥ 88% for existing ones |
| D. Toolchain | Enable static mutants, add shard and merge scripts with a guard test, fix the workflow, update the guide | `stryker.config.json`, `scripts/mutation/**`, the mutation workflow, `docs/how-to/develop-and-test.md`, `docs/reference/workflows.md`, tests for the scripts | Full run within the 25-minute budget per shard |
| E. Defects | Fix S1–S4, each with a failing test first, then kill the remaining survivors in both files | `src/plugins/connector-azure-devops/domain/markdown-html.ts`, `src/plugins/backlog/domain/notes.ts`, a new `tests/connector-azure-devops/markdown-html.unit.test.ts`, `tests/backlog/notes.unit.test.ts` | ≥ 90% |
| F. Vault-check and workflows | Mutate `vault-check/domain/*.ts` and `workflows/workflow.ts`; rewrite `suggestion.ts:15`; move the workflow fixture into the tests | those sources and `tests/vault-check`, `tests/workflows/workflow.unit.test.ts` | ≥ 85% |

**Rules for every area:**

- Assert observable behavior and prefer table-driven tests.
- Build fixtures inside each test.
- Leave equivalent mutants alone and list them with a reason.
- A real defect gets a failing test first, then the fix.
- Never weaken checks or thresholds.
- Use focused Stryker runs with a scratch configuration (`ignoreStatic: false`, a private incremental file and report directory) to report each file's score before and after.
- Run `npm run check:fast` and `npm test` before handing back.

## Integration

1. Merge the area branches with `--no-ff`. Add the wave-1 globs to `mutate`.
2. Run the full mutation suite once and set the threshold from it.
3. Update the baseline, hot spots and lessons in the guide.
4. Run `workflows sync`, `npm run build`, `npm run showcase`, the full `npm run check` and `workflows sync --check`.
5. Run an independent adversarial review of the combined diff, then ship through CI.

## Results

Filled in after integration.
