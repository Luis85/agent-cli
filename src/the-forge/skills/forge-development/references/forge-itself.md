# Changing The Forge itself

Read this when you change The Forge's own source (`src/the-forge` in the source checkout).

- Work in the project folder: `npm ci` once, then iterate with `npm run check:fast`. `npm run check:contracts` diagnoses command, schema, localization, reference-doc and evaluation-budget failures without a build.
- Update docs and skills with every user-visible change, then run `npm run check` and commit the rebuilt workspace executable and packaged assets with the source. Do not ship a stale bundle.
- `npm run check` replays every agent evaluation task in `evals/tasks` with the reference driver. When you add an agent-facing command, add or extend a task with reference steps and deterministic checks, keep the suite within its budget (`docs/how-to/evaluate-agents.md`, at most 35 tasks) and validate it with `npm run eval -- --task <id>`. Keep existing acceptance checks.
- Measure a real agent with the opt-in `npm run eval -- --driver claude`.
- Keep the seven `check:contracts` suites source-only. Portable help and artifacts still need the full gate after the build.
- Mutation testing runs in CI only. To investigate one file's surviving mutants, run `npm run mutate -- --mutate <file>` as `docs/how-to/develop-and-test.md` shows.
- Preserve local configuration, shared plugins and templates, and project selection.
- `npm run release` builds a downloadable archive.
