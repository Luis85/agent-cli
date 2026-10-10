# The Forge

A portable Node CLI for AI-assisted engineering, TypeScript projects and Obsidian-compatible files. Built with strict TypeScript, Vite and Vitest. The Forge runs without Obsidian, npm installation, or runtime packages in your project.

## Use the committed bundle

Requires **Node 22.12 or newer**. Extract a release into a new workspace, or copy the complete repository `bin` folder and reset its checkout-specific configuration as shown below. Run `node bin/app.js`; the executable contains all runtime dependencies. Keep `bin/package.json` beside it so the app runs in ESM and CommonJS parent projects. Authored process skills live in `bin/skills`; packaged documentation, type declarations and notices live in `bin/data`. Shipped defaults live in `bin/config/default.json`; active workspace settings remain in `bin/config.json`.

The following quickstart assumes a new portable workspace. This source checkout instead selects its own `src/the-forge` project; see [source organization](#source-organization) before running file or generation commands here.

```sh
node bin/app.js --help
node bin/app.js schema --json
node bin/app.js setup --dry-run
node bin/app.js setup
node bin/app.js project create knowledge-core --dry-run
node bin/app.js project create knowledge-core
node bin/app.js project open knowledge-core
node bin/app.js project current --json
node bin/app.js project component WorkItem --kind domain
node bin/app.js make form Contact --dry-run
node bin/app.js make form Contact
node bin/app.js make entity Decision --out src/domain --dry-run
node bin/app.js make entity Decision --out src/domain
node bin/app.js create notes/plan.md --content '# Development plan'
node bin/app.js read notes/plan.md --json
node bin/app.js project close
node bin/app.js components init
node bin/app.js make ui page --framework react --stories --dry-run
```

`setup` initializes missing app/config files, shared `bin/plugins` and `bin/templates`, packaged assets in `bin/data`, process skills and a lean `AGENTS.md`. It preserves existing files. Configure the projects directory, component-library/UI/story/import/export paths, formatting, template dates and enabled plugins in `bin/config.json`; the `bin` layout is fixed.

`project open` persists the selected project across invocations. File commands and code/document generators use that project's root until `project close`. Templates and plugins stay shared in the workspace. Responses include `context` so an agent can verify the target. Generated projects include a Vite form showcase: run `npm install` and `npm run dev` inside the project, then open its local URL. See [form generation and rendering](docs/reference/forms.md). The CLI never prompts or starts an interactive shell. All responses are JSON; `--json` makes them compact. Put routing options before the command: `node bin/app.js --root /path/to/workspace setup`. See [configuration](docs/reference/configuration.md) and [project workflows](docs/how-to/manage-projects.md).

To download the committed distribution from the repository into a new, empty workspace, reset the copied settings and selection in that new destination:

```sh
curl -fL https://github.com/Luis85/agent-cli/archive/refs/heads/main.tar.gz -o agent-cli-source.tar.gz
tar -xzf agent-cli-source.tar.gz
cp -R agent-cli-main/bin ./bin
cp bin/config/default.json bin/config.json
rm -f bin/data/context.json
node bin/app.js --version
node bin/app.js setup
```

This URL serves the latest `main` branch. For a fixed version, use a reviewed commit archive instead. The reset commands apply only to the new copy: the repository itself intentionally selects `the-forge`, and `setup` preserves existing settings and selection. Maintainers can produce `release/forge-0.1.0.tar.gz` with `npm run release`; its `bin` already contains generic defaults and no selected project. Releases are not automatically published. For an existing installation, extract separately and preserve configuration, shared plugins/templates and project selection when updating the executable and packaged assets.

## Capabilities

- `make`: TypeScript entity, value object, use case and event scaffolds; typed form definitions with validation and HTML rendering; Obsidian-inspired plugin directories; Markdown documents from frontmatter-aware templates. Plugins contribute more generators without rebuilding the CLI.
- `components`, `interactions`, `make ui`, `make stories`: maintain Markdown/frontmatter component libraries and generate deterministic HTML, HTMX, vanilla JS, Vue, Svelte, React or Angular boilerplate with Storybook CSF stories and native extension modules. Shared interaction definitions generate typed local state and executable browser-event actions across all seven targets; see [interactions](docs/reference/interactions.md) and [UI components](docs/reference/ui-components.md).
- `templates`, `config`: inspect template inputs and effective configuration; install editable PRD, use-case, build-spec, design, implementation, test and release templates.
- `data-sources`, `make data-source`: manage Markdown-defined REST/local JSON data sources and generate deterministic TypeScript adapters; see [data sources](docs/reference/data-sources.md).
- `setup`, `project`: initialize a workspace, discover and select independent TypeScript libraries, and add domain or application components.
- `create`, `read`, `write`, `edit`, `properties`, `patch`, `validate`, `list`: Markdown/YAML properties, JSON Canvas graphs, Bases YAML, UTF-8 source and data files, and lossless attachment handling.
- `schema`, `help`, `formats`, `events`, `plugins`: discover the installed contracts and capabilities.
- `skills`: inspect and install agent workflows for safe file editing, feature development and verification.
- Explicit runtime plugins: manifest discovery, `onload`/`onunload`, commands, generators, validated events and skills.
- `claude`: maintain native Claude Code agents, hooks and plugin assets with revision guards, and manage installed plugins/marketplaces through the Claude CLI. See [Claude Code management](docs/reference/claude.md).
- `bases`: query a native `.base` view as a repository definition and return its matching files without installing Obsidian. See [Bases queries](docs/reference/bases.md).
- SHA-256 revision checks, dry-run previews, contained paths, collision checks and notifications after successful commits.

Markdown syntax (wikilinks, embeds, callouts, code, math) remains intact and generated Markdown can be edited in Obsidian Source mode. Canvas receives structural graph validation. Bases queries evaluate saved filters, formulas and view ordering through a bundled standalone expression engine; `bases capabilities` describes its compatibility profile. Images, audio, video and PDF are read, copied, replaced and exported as bytes/base64. Rendering, media transformations, PDF text editing and community-plugin semantics require extensions. See the precise [format contract](docs/reference/formats.md).

## Edit safely

Confirm the selection with `project current`, then read the file and verify its response's `context.root`. Copy `data.revision` into `--if-match`:

```sh
node bin/app.js properties notes/plan.md --set '{"status":"draft","tags":["engineering"]}' --if-match YOUR_REVISION --dry-run
node bin/app.js properties notes/plan.md --set '{"status":"draft","tags":["engineering"]}' --if-match YOUR_REVISION
```

Use `--stdin` for multiline text or binary input. For example:

```sh
node bin/app.js write assets/diagram.png --stdin < diagram.png
node bin/app.js create plan.canvas
node bin/app.js create tasks.base
```

Existing files cannot be overwritten without their current revision. A conflict requires rereading and reconciling the change. Dry runs validate the same input, check `--if-match` like the real write, and report planned hashes, paths and a unified `diff` per text file without writing files or emitting file events. Responses carry only committed file-change events by default; add `--events all` for the full lifecycle history. See [dry-run diffs](docs/reference/cli.md#dry-run-diffs).

If a write reports `WORKSPACE_BUSY`, another writer may still be active or an interrupted process may have left a lock. Follow the [write and recovery contract](docs/reference/cli.md#write-contract) before removing it.

## Documentation

Use the [documentation hub](docs/index.md) to choose a learning path or find an exact contract. The docs follow Diátaxis:

- **Tutorials:** [getting started](docs/tutorials/getting-started.md), [your first UI](docs/tutorials/first-ui.md), and [idea to production](docs/tutorials/idea-to-production.md).
- **How-to guides:** [manage projects](docs/how-to/manage-projects.md), [regenerate components](docs/how-to/manage-components.md), [develop and test](docs/how-to/develop-and-test.md), and [build a release](docs/how-to/release.md).
- **Reference:** [CLI](docs/reference/cli.md), [configuration](docs/reference/configuration.md), [component definitions](docs/reference/ui-components.md), [Storybook](docs/reference/storybook.md), and [plugins](docs/reference/plugins.md).
- **Explanation:** [architecture](docs/explanation/architecture.md) and [deterministic generation](docs/explanation/deterministic-ui.md).

The [idea-to-production example pack](docs/examples/idea-to-production/README.md) includes filled-in discovery, requirements, design, implementation, testing and production artifacts. [Agent skills](bin/skills/forge-workflow.md) and the [runnable example plugin](docs/examples/plugins/quality/main.mjs) support day-to-day use.

## Source organization

The runtime source lives in `src/the-forge`, using domain, application, infrastructure and presentation layers divided into concern folders. `src/the-forge/main.ts` composes the runtime; `src/the-forge/sdk.ts` exposes plugin types. The package, Vite/TypeScript configuration, tests, `scripts/` and `configs/` remain at the repository root. Examples live in `docs/examples`, and authored workflow/project templates in `docs/templates`; editable runtime templates remain in `bin/templates`. Run npm commands from the repository root. The repository's `src/the-forge/README.md` maps entry points; the [architecture](docs/explanation/architecture.md) explains dependency rules.

This checkout manages its own source as a Forge project. Tracked `bin/config.json` sets `paths.projects` to `src`, `src/the-forge/.forge/project.json` identifies the project, and `bin/data/context.json` selects `the-forge`. Verify it before using project-relative paths:

```sh
node bin/app.js project current --json
node bin/app.js project open the-forge
node bin/app.js read README.md --json
node bin/app.js make entity SourceProbe --out domain/example --dry-run
```

Here `read README.md` reads `src/the-forge/README.md`. An explicit `--out domain/<concern>` targets that source project's layer; the generic generator default `src/domain` would create an extra `src` directory beneath it. `project close` returns file commands to the repository root; `project open the-forge` restores source scope. Builds preserve this checkout configuration and selection. Released bundles keep generic `projects` defaults and no saved selection. Forge's quality source policy scopes its own checks to `src/the-forge`, leaving sibling managed projects under `src` to their own toolchains.

## Develop

```sh
npm ci
npm run check:fast
npm run check
npm run release
```

`check:fast` checks source/test structure, then runs Oxlint, fallow and TypeScript checks during development. `check` adds a fresh build and the labeled unit, integration and end-to-end tests. Fix the cause of a failing stage, rerun it, then finish with `check`; see the [development feedback loop](docs/how-to/develop-and-test.md#agent-feedback-loop). Commit source and the rebuilt `bin` distribution together. The checkout tracks its self-management configuration and selection; installed plugins, editable templates and other workspaces' local context remain operating data. The CLI bundle needs only Node; developing The Forge or a generated project requires its development dependencies, including native Oxlint/fallow binaries.

MIT licensed. This is an independent tool, not an official Obsidian CLI.
