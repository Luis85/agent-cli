# Explore and regenerate the showcase

[Documentation](../index.md) · How-to guide

The repository commits a fully generated example project, `src/forge-showcase`. It describes Trailhead, a small fictional trip-planning web app, and demonstrates The Forge end to end: workflow documents linked into an Obsidian knowledge graph, a Canvas map and Bases views, a component library with interactions generated for all seven UI targets with Storybook stories, REST and local JSON data sources with typed adapters and fixtures, domain and application code, forms, a native Claude agent, installed agent skills and the project's own CI workflow. Its `README.md` maps every folder to the commands that produced it, and `docs/Build log.md` lists every invocation in order.

The showcase is available in a source checkout of the repository. Release bundles do not contain it.

## Browse it in Obsidian

Open `src/forge-showcase` as an Obsidian vault and start at `docs/Trailhead.md`. Wikilinks and frontmatter links connect the PRD, use cases, design, delivery plans, component and interaction definitions and data sources. `docs/maps/Trailhead map.canvas` shows the architecture, and `docs/bases` holds native Bases views for documents by stage, requirement traceability and library backlinks.

You can also open the whole repository as a vault. Wikilinks still resolve by unique note name, but Canvas file nodes use paths relative to the showcase folder, so the map's file cards only resolve in the showcase vault.

Query the same Bases views without Obsidian. File commands need the showcase selected; restore the checkout's own selection afterwards:

```sh
node bin/app.js project open forge-showcase
node bin/app.js bases query docs/bases/Requirements.base --view REQ-004
node bin/app.js project open the-forge
```

UI and data-source drift checks accept `--project` and leave the selection unchanged:

```sh
node bin/app.js make ui trip-planner --framework react --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/react/components --stories --stories-out ui/react/stories --check
```

## Run the showcase's own checks

The showcase is an independent project with its own toolchain, lockfile and tests. From its directory:

```sh
cd src/forge-showcase
npm ci
npm run check
```

Its CI workflow is authored at `src/infrastructure/workflows/check/check.yml` inside the project and assumes that it runs with the project directory as its working directory. The Forge repository's own gate does not lint, analyze or type-check the showcase; `configs/quality/source.json` limits Forge's source inventory to `src/the-forge`.

## Regenerate and check drift

From the repository root, after `npm run build`:

```sh
npm run showcase
npm run showcase:check
```

`npm run showcase` runs `scripts/showcase.mjs`. The script creates a temporary workspace with a fixed configuration, drives the bundled `bin/app.js` with `--root` and `--json`, fixed inputs and the fixed date `2026-10-10T09:00:00Z`, checks every exit status and `ok` field, and fails loudly on the first error. It then replaces exactly `src/forge-showcase` with the generated project. It never changes the checkout's project selection, configuration, templates or plugins, and it fails if generation writes outside the project. Running it twice produces identical bytes and uses no network.

`npm run showcase:check` regenerates into a temporary workspace only and compares the result with the committed tree. It exits nonzero and lists each `missing`, `unexpected` or `changed` path, without modifying the checkout. Untracked toolchain outputs such as `node_modules`, `dist` and `.quality-reports` are ignored.

The lockfile is produced by npm, not by the CLI. Regeneration keeps the committed `package-lock.json`, and the drift check verifies that it still names the generated package's direct dependencies. After changing the scaffold's dependencies, refresh it explicitly; this step uses the npm registry:

```sh
npm run showcase -- --lockfile
```

When a change alters generated output or adds a user-visible capability, extend `scripts/showcase/`, regenerate and commit the showcase with the change. Do not edit generated showcase files by hand. See [develop and test](develop-and-test.md) for the full repository gate.
