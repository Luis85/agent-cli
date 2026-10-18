# __FORGE_PROJECT_NAME__

TypeScript library scaffolded by The Forge. Requires Node 22.12 or newer.

Run `npm install` once from this project directory, commit the resulting lockfile, then use `npm ci` for reproducible installs. The scaffold does not install or execute dependencies.

## Forge project context

Run Forge commands from the containing environment directory, where `bin/forge.js` lives. Select this project with `node bin/forge.js project open __FORGE_PROJECT_NAME__`, then verify `node bin/forge.js project current` before writes. The selection persists in the environment's `bin/data/context.json` across invocations; `project close` clears it. File commands and `make` outputs target the selected project, so `node bin/forge.js create notes/plan.md --content "# Plan"` creates a note inside this project. Add components with `node bin/forge.js project component WorkItem --kind domain --dry-run`, review the plan, then repeat without `--dry-run`. Project management stays scoped to the environment, and Markdown template sources are shared in its `bin/templates` folder.

## Form showcase

Run `npm run dev` from this project directory and open the local Vite URL. The Project Details form demonstrates labeled native HTML inputs, Zod validation and local result preview; it does not send or save data. Edit `src/presentation/forms/project-details.form.ts` to change the model. From the containing environment, run `node bin/forge.js make form Contact` after selecting this project. Reload the preview to choose the new form. Definitions under `src/presentation/forms/**/*.form.ts` are discovered automatically; definitions elsewhere need an explicit import.

The library exports `ProjectDetailsForm`, `validateForm` and `renderForm`. Validation works without a browser; call the renderer with a real DOM container and a submission callback. `npm run build` writes the library and declarations to `dist`, and the interactive showcase to `demo-dist`. Use `npm run preview` to serve the built showcase.

## Development feedback loop

1. Define acceptance criteria and inspect the affected code and tests.
2. Make a focused change; use `npm test -- --project unit` to check its behavior.
3. Run `npm run check:fast` for test-pyramid structure, Oxlint correctness/code-line limits, fallow-rs unused-code/import-boundary analysis, and strict TypeScript checks. Each command exits nonzero on failure.
4. Repair the first reported failure and rerun its command. Structure, lint and analysis emit structured JSON and save diagnostics to `.quality-reports/structure.json`, `.quality-reports/oxlint.json` and `.quality-reports/fallow.json`. Do not hide findings by broadening analysis entries, adding suppressions, or disabling checks.
5. Run `npm run check` before handoff; it adds the Vite library and demo builds, declaration generation, and all Vitest tests. Report the commands and results.

Keep source files at most 400 code-bearing lines and tests/test support at most 450; blank lines and comment-only lines do not count. Split by responsibility when approaching the limit. Name tests `*.unit.test.ts` for isolated behavior, `*.integration.test.ts` for collaborating components, or `*.e2e.test.ts` for a complete public workflow. Prefer many focused unit tests, fewer integration tests, and a small set of end-to-end tests. Select a layer with `npm test -- --project unit` (or `integration` / `e2e`); run the full suite before handoff.

Keep business invariants in `src/domain`, use cases and injected ports in `src/application`, adapters in `src/infrastructure`, and composition in `src/presentation`. Core layers use only relative imports and cannot depend on outer layers; keep platform libraries behind injected ports. These boundaries are enforced by the lint and analysis configurations under `configs/`. Export the intended public API from `src/index.ts`. New components start internal and are exercised by their generated tests; explicitly export them when they become part of the library contract. Generated data-source adapters (`make data-source --out src/infrastructure/data-sources`) have no generated test, so export them from `src/index.ts` before `npm run analyze`, or it reports them as unused. `make ui` and `make stories` generate framework UI and Storybook stories for downstream applications under `ui/<framework>` by default (`make ui <component> --framework react --stories` writes `ui/react/components` and `ui/react/stories`): their frameworks are not dependencies of this library, so its checks skip `ui/`.

The sample `ProjectIdentity` demonstrates domain identity validation; `ProjectDetailsForm` demonstrates a separate presentation model. Replace examples with the project's business vocabulary and acceptance criteria. Static checks enforce specific rules; focused behavior tests remain necessary.
