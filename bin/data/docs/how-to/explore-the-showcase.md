# Explore and regenerate the showcase

[Documentation](../index.md) · How-to guide

The repository commits a fully generated example project, `src/forge-showcase`. It describes Trailhead, a small fictional trip-planning web app, and demonstrates The Forge end to end: workflow documents linked into an Obsidian knowledge graph, a Canvas map and Bases views, a backlog-view compatible product backlog, a component library with interactions generated for all seven UI targets with Storybook stories, REST and local JSON data sources with typed adapters and fixtures, domain and application code, forms, a native Claude agent, installed agent skills and the project's own CI workflow. Its `README.md` maps every folder to the commands that produced it, and `docs/Build log.md` lists every invocation in order.

The showcase is available in a source checkout of the repository. Release bundles do not contain it.

## Browse it in Obsidian

Open `src/forge-showcase` as an Obsidian vault and start at `docs/Trailhead.md`. Wikilinks and frontmatter links connect the PRD, use cases, design, delivery plans, component and interaction definitions and data sources. `docs/maps/Trailhead map.canvas` shows the architecture, and `docs/bases` holds native Bases views for documents by stage, requirement traceability and library backlinks. The verification plan was generated as "Trip planner test plan" and then renamed with `rename`, which rewrote every wikilink, frontmatter link and the Canvas card that named it, and a scratch note was deleted into `.trash/`; the build log lists both steps.

You can also open the whole repository as a vault. Wikilinks still resolve by unique note name, but Canvas file nodes use paths relative to the showcase folder, so the map's file cards only resolve in the showcase vault.

Query the same Bases views, search the notes and check the link graph without Obsidian. File commands need the showcase selected; restore the checkout's own selection afterwards:

```sh
node bin/forge.js project open forge-showcase
node bin/forge.js bases query docs/bases/Requirements.base --view REQ-004
node bin/forge.js search REQ-004 --kind markdown --path "docs/**" --in body
node bin/forge.js links back "docs/product/Trailhead PRD.md"
node bin/forge.js links unresolved
node bin/forge.js links orphans --path "docs/**"
node bin/forge.js project open the-forge
```

The README's "Search and link reports" section records these results from generation; in the committed vault `links unresolved` and `links orphans --path "docs/**"` report none.

The `backlog` folder holds a product backlog that the Obsidian Product Backlog view (backlog-view) opens unchanged: Epics, Features, PBIs, a Bug and Tasks with ranks, states and stamps, assignees, dependencies, an iteration and two releases, configured by `backlog/Product Backlog.base`. Inspect it with the same selection:

```sh
node bin/forge.js backlog tree
node bin/forge.js backlog board
node bin/forge.js backlog release readiness "Trailhead 1.0"
node bin/forge.js backlog check
```

The README's "Product backlog" section records these reports, and `backlog/release-notes` holds the generated release notes. See [plan and release work in a product backlog](manage-backlog.md).

UI and data-source drift checks accept `--project` and leave the selection unchanged:

```sh
node bin/forge.js make ui trip-planner --framework react --project forge-showcase --library src/forge-showcase/library/components --interactions-library src/forge-showcase/library/interactions --out ui/react/components --stories --stories-out ui/react/stories --check
```

## Run the showcase's own checks

The showcase is an independent project with its own toolchain, lockfile and tests. From its directory:

```sh
cd src/forge-showcase
npm ci
npm run check
```

Its CI workflow is authored at `src/infrastructure/workflows/check/check.yml` inside the project and stays independent of its location. From the workspace root, `node bin/forge.js workflows sync` generates `.github/workflows/forge-showcase--check.yml`, which runs the steps in the project directory on Node 22.12 and 24 and only for changes to the project; see [workflows](../reference/workflows.md). The Forge's own gate does not lint, analyze or type-check the showcase: Forge's checks cover only its own project directory, `src/the-forge`.

## Regenerate and check drift

From the Forge project directory `src/the-forge`, after `npm run build`:

```sh
cd src/the-forge
npm run showcase
npm run showcase:check
```

`npm run showcase` runs the Forge project's `scripts/showcase.mjs`. The script finds the workspace as the parent of the `bin/` directory that `config.distribution` in `package.json` names, creates a temporary workspace with a fixed configuration, drives the workspace's bundled `bin/forge.js` with `--root` and `--json`, fixed inputs and the fixed date `2026-10-10T09:00:00Z`, checks every exit status and `ok` field, and fails loudly on the first error. It then replaces exactly the workspace's `src/forge-showcase` with the generated project. It never changes the checkout's project selection, configuration, templates or plugins, and it fails if generation writes outside the project. Running it twice produces identical bytes and uses no network.

`npm run showcase:check` regenerates into a temporary workspace only and compares the result with the committed tree. It exits nonzero and lists each `missing`, `unexpected` or `changed` path, without modifying the checkout. Untracked toolchain outputs such as `node_modules`, `dist` and `.quality-reports` are ignored.

The lockfile is produced by npm, not by the CLI. Regeneration keeps the committed `package-lock.json`, and the drift check verifies that it still names the generated package's direct dependencies. After changing the scaffold's dependencies, refresh it explicitly; this step uses the npm registry:

```sh
npm run showcase -- --lockfile
```

When a change alters generated output or adds a user-visible capability, extend `scripts/showcase/`, regenerate and commit the showcase with the change. Do not edit generated showcase files by hand. See [develop and test](develop-and-test.md) for the full Forge gate.
