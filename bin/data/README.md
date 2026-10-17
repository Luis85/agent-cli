# The Forge

A terminal project companion for AI-assisted project and product development. The user works in Obsidian. The AI agent uses this portable Node CLI to create, edit and verify the same Markdown, Canvas and Bases files, without Obsidian running or installed. Specifications, design, documentation, the backlog and code form one Git-backed knowledge graph. See the [product vision](docs/explanation/product-vision.md).

The CLI is built with strict TypeScript, Vite and Vitest. It needs no npm installation and no runtime packages in your project.

## Use the committed bundle

For other projects, install the [published 0.1.0 release](https://github.com/Luis85/agent-cli/releases/tag/v0.1.0) with its checksum-verifying installer. The [installation guide](docs/how-to/install.md) gives an agent-executable workflow for online and offline installation on Linux, macOS and Windows. The archive contains generic defaults and no saved project selection.

Requires **Node 22.12 or newer**. Extract a release into a new workspace, or copy the complete repository `bin` folder and reset its checkout-specific configuration as shown below. Run `node bin/forge.js`, a small launcher that loads the runtime bundle `bin/forge-runtime.js`, which contains the CLI runtime dependencies. Browser automation additionally uses the complete packaged Playwright module in `bin/browser-runtime/playwright-core`; no npm installation is needed in a user workspace. Keep both files and `bin/package.json` together so the app runs in ESM and CommonJS parent projects. The detached localhost server also needs `bin/forge-server.cjs`; separately packaged webviews live in `bin/webviews/`. Copy the complete distribution to preserve these assets. Packaged process skills live in `bin/skills`; packaged documentation, type declarations and notices live in `bin/data`. Shipped defaults live in `bin/config/default.json`; active workspace settings remain in `bin/config.json`.

The following quickstart assumes a new portable workspace. This source checkout instead selects its own `src/the-forge` project; see [source organization](#source-organization) before running file or generation commands here.

```sh
node bin/forge.js --version
node bin/forge.js setup --dry-run
node bin/forge.js setup
node bin/forge.js project create knowledge-core --dry-run
node bin/forge.js project create knowledge-core
node bin/forge.js project open knowledge-core
node bin/forge.js project current --json
node bin/forge.js create notes/plan.md --content '# Development plan' --dry-run
node bin/forge.js create notes/plan.md --content '# Development plan'
node bin/forge.js read notes/plan.md --json
```

Run these commands from the workspace root. Continue only when `ok` is `true` and the process exits successfully. The last response should identify `projects/knowledge-core` in `context.root` and return the note's `data.revision`. You now have a project and a planning note; use that revision in the [safe-edit loop](#edit-safely), or follow the [getting-started tutorial](docs/tutorials/getting-started.md) through validation.

For a known task, use `help <command>` for usage and `schema <command> --json` for its exact contract, for example `help edit` and `schema edit --json`. `schema --json` alone is a compact index of command ids; request the full `schema --all --json` only when you need the complete installed catalog. The [documentation hub](docs/index.md) routes to code, UI, backlog and agent workflows when you need them.

`setup` initializes missing app/config files, shared `bin/plugins` and `bin/templates`, packaged assets in `bin/data`, process skills as Agent Skills folders in `.claude/skills` and `.agents/skills`, and a lean `AGENTS.md`. It preserves existing files. Configure the projects directory, component-library/UI/story/import/export paths, formatting, enabled and disabled plugins and plugin settings such as template date formats (`plugins.settings.templates`) in `bin/config.json`; the `bin` layout is fixed.

Every project-scoped file command (`list`, `read`, `read-many`, `stat`, `search`, `links`, `vault`, `validate`, `create`, `write`, `edit`, `properties`, `patch`, `move`, `rename`, `delete` and `apply`) accepts `--project <id>` for one invocation without changing shared selection. Use the same explicit target for reads, previews and edits when agents work in parallel. Writes in different projects still share the workspace writer lock, so an overlapping write may return retryable `WORKSPACE_BUSY`; see [project targeting](docs/how-to/target-projects.md). `read-many` returns up to 32 ordered reads with revisions under an 8 MiB aggregate budget, each file truncated at `--max-bytes` as `read` truncates it; see [batch reads](docs/how-to/read-many.md).

`project open` persists the selected project across invocations. File commands and code/document generators use that project's root until `project close`. Templates and plugins stay shared in the workspace. Responses include `context` so an agent can verify the target. Generated projects include a Vite form showcase: run `npm install` and `npm run dev` inside the project, then open its local URL. See [form generation and rendering](docs/reference/forms.md). The CLI never prompts or starts an interactive shell. All responses are JSON; `--json` makes them compact. Put routing options before the command: `node bin/forge.js --root /path/to/workspace setup`. See [configuration](docs/reference/configuration.md) and [project workflows](docs/how-to/manage-projects.md).

To download the committed distribution from the repository into a new, empty workspace, reset the copied settings and selection in that new destination:

```sh
curl -fL https://github.com/Luis85/agent-cli/archive/refs/heads/main.tar.gz -o agent-cli-source.tar.gz
tar -xzf agent-cli-source.tar.gz
cp -R agent-cli-main/bin ./bin
cp bin/config/default.json bin/config.json
rm -f bin/data/context.json
node bin/forge.js --version
node bin/forge.js setup
```

This URL serves the latest `main` branch. For a fixed version, use a reviewed commit archive instead. The reset commands apply only to the new copy: the repository itself intentionally selects `the-forge`, and `setup` preserves existing settings and selection. Maintainers can produce `src/the-forge/release/forge-0.1.0.tar.gz` with `npm run release` from `src/the-forge`; its `bin` already contains generic defaults and no selected project. The tested release workflow publishes tags; see [build and publish a release](docs/how-to/release.md). For an existing installation, extract separately and preserve configuration, shared plugins/templates and project selection when replacing `bin/forge.js`, `bin/forge-runtime.js` and the packaged assets together.

## Capabilities

- `update check`, `update apply`: discover stable GitHub releases and apply checksum-verified upgrades with previews and revision guards, preserving local configuration and projects. See [app updates](docs/reference/updates.md).

- `make`: TypeScript entity, value object, use case and event scaffolds; typed form definitions with validation and HTML rendering; Obsidian-inspired plugin directories; Markdown documents from frontmatter-aware templates. The code, form and plugin scaffolds come from the bundled `scaffolds` core plugin (which also provides the `project create` and `project component` files) and `make document` from `templates`. Plugins contribute more generators without rebuilding the CLI.
- `components`, `interactions`, `make ui`, `make stories`: maintain Markdown/frontmatter component libraries and generate deterministic HTML, HTMX, vanilla JS, Vue, Svelte, React or Angular boilerplate with Storybook CSF stories and native extension modules. Shared interaction definitions generate typed local state and executable browser-event actions across all seven targets. Delivered by the bundled `ui` core plugin; see [interactions](docs/reference/interactions.md) and [UI components](docs/reference/ui-components.md).
- `templates`, `config`: inspect template inputs and effective configuration; install editable PRD, use-case, build-spec, design, implementation, test and release templates. `templates` is delivered by the bundled `templates` core plugin; see [templates](docs/reference/templates.md).
- `data-sources`, `make data-source`: manage Markdown-defined REST/local JSON data sources and generate deterministic TypeScript adapters. Delivered by the bundled `data-sources` core plugin; see [data sources](docs/reference/data-sources.md).
- `setup`, `project`: initialize a workspace, discover and select independent projects, scaffold TypeScript libraries or Vue/Nuxt UI webviews (`project create <id> --type webview`), and add library domain or application components.
- `browser`: capture on-demand webpage screenshots and generate illustrated tutorials from explicit JSON, Markdown or Canvas flow plans. Guarded PNG/document output supports problem reports and walkthroughs; see [capture browser evidence](docs/how-to/capture-browser-evidence.md).
- `webview`: inspect and publish a selected webview project's static build with revision guards and drift checks. Each prototype owns its toolchain, local fixtures and Playwright tests; the existing CLI server manages previews. See [prototype a webview](docs/how-to/prototype-webviews.md) and the [webview contract](docs/reference/webviews.md).
- `server`: start, inspect and stop the workspace localhost server, discover installed webviews even while stopped, and return authenticated launch links. `server start --webview admin` opens the inspection workflow for workspace/project context, plugins and runtime state; the CLI returns its URL without launching a browser. See [use the admin webview](docs/how-to/use-admin-webview.md) and the [server contract](docs/reference/server.md).
- `workflows`: keep each project's CI inside the project under `src/infrastructure/workflows/<concern>/`, generate prefixed, path-scoped `.github/workflows` entrypoints with `workflows sync`, and fail CI on drift with `workflows sync --check`. See [workflows](docs/reference/workflows.md).
- `create`, `read`, `read-many`, `write`, `edit`, `properties`, `patch`, `validate`, `list`: Markdown/YAML properties, JSON Canvas graphs, Bases YAML, UTF-8 source and data files, and lossless attachment handling. `edit` replaces literals (one, or an ordered `--edits` list) and edits Markdown sections by heading path (`--section "Plan > Risks"`) or blocks by `^id`.
- `stat`: inspect a file or folder revision and compact size/count metadata without returning or parsing its content. Use invocation-local `--project` when needed; see [inspect file metadata](docs/how-to/inspect-file-metadata.md).
- `apply`: run a JSON plan of writes, edits, frontmatter changes, moves and deletions in order and commit it as one guarded batch with one dry-run diff, rollback and one set of events. See [make precise edits](docs/how-to/make-precise-edits.md).
- `vault check`, `vault tags`, `vault properties`: verify the vault (unresolved links, embeds and anchors, invalid frontmatter, Canvas and Bases, conflicting property types, duplicate block ids, empty files, orphaned attachments) with `--strict` as a gate, and inventory tags and properties. Delivered by the bundled `vault-check` core plugin; see [vault checks](docs/reference/vault.md).
- `search`: find literal text or regular expressions in the vault's text files with tag, property, path and kind filters, Markdown body or frontmatter scopes, context lines, paging and a matching time budget. Delivered by the bundled `search` core plugin; see [search](docs/reference/search.md).
- `links`: report one note's outgoing links and backlinks, every unresolved or ambiguous link, orphaned notes and dead ends from the metadata cache. Delivered by the bundled `links` core plugin; see [links](docs/reference/links.md).
- `agents`: author agent definitions as [docker-agent](https://github.com/docker/docker-agent) compatible YAML, validate them, import Claude Code agents, and generate reviewed, drift-checked Claude Code agents, skills, hooks, MCP servers and permission rules from them. Delivered by the bundled `agents` core plugin; see [agents](docs/reference/agents.md).
- `move`, `rename`, `delete`: restructure the vault like Obsidian does. Moves rewrite every wikilink, embed, Markdown link, frontmatter link and Canvas file node in one guarded batch; deletion moves files to `.trash/` and refuses while other notes still link to them. See [moving and deleting](docs/reference/cli.md#moving-and-deleting).
- `schema`, `help`, `formats`, `events`, `plugins`: discover the installed contracts and capabilities. Every command declares its metadata (scope, read-only or mutating, described options and arguments, error codes); `schema` publishes it as a JSON Schema 2020-12 contract: an `inputSchema` per command, an `outputSchema` where the command declares one (the read and report commands, `read-many`, `stat`, `vault`, `server`, `webview`, `browser` and `update`, and the mutating commands `create`, `write`, `edit`, `properties`, `patch`, `apply`, `move`, `rename`, `delete`, `make`, `project` and the plugin actions that commit one guarded batch), behavior annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) and the response envelope. See the [schema contract](docs/reference/schema.md).
- `skills`: inspect and install [Agent Skills](docs/how-to/install-agent-skills.md) for safe file editing, feature development and verification into `.claude/skills` and `.agents/skills`. Delivered by the bundled `skills` core plugin.
- `backlog`: plan, rank, track and release product work in notes that the Obsidian Product Backlog view (backlog-view) opens unchanged, configured by a `.base` view. Delivered by the bundled `backlog` core plugin; see [backlog](docs/reference/backlog.md).
- `connectors`, `backlog sync`: two-way sync of backlog views with external work trackers, starting with Azure DevOps Boards, with explicit conflicts, connection profiles in workspace config and tokens read from environment variables. Delivered by the bundled `connector` and `connector-azure-devops` core plugins; see [connectors](docs/reference/connectors.md) and [sync a backlog with Azure DevOps](docs/how-to/sync-backlog-with-azure-devops.md).
- Bundled core plugins (enabled by default, disabled with `plugins.disabled`) and explicit user plugins on one contract with an Obsidian-shaped `app` facade (`vault`, `metadataCache`, `fileManager`, `workspace`): manifest discovery, `onload`/`onunload`/`onUserEnable`/`onExternalSettingsChange`, `onLayoutReady` and quit tasks, commands with metadata, generators, validated events with host-owned Obsidian-style `vault.*`, `metadataCache.*` and `workspace.*` namespaces, skills, provided and required services, validated config sections under `plugins.settings`, localized strings and error codes. See [plugins](docs/reference/plugins.md).
- `claude`: maintain native Claude Code agents, hooks and plugin assets with revision guards, and manage installed plugins/marketplaces through the Claude CLI. Delivered by the bundled `claude` core plugin, which also offers trusted plugins its `claude.lifecycle` service. See [Claude Code management](docs/reference/claude.md).
- `bases`: query a native `.base` view as a repository definition and return its matching files without installing Obsidian. Delivered by the bundled `bases` core plugin, which also offers the `bases.validation` service that `vault check` uses; see [Bases queries](docs/reference/bases.md).
- SHA-256 revision checks, dry-run previews, contained paths, collision checks and notifications after successful commits.

Markdown syntax (wikilinks, embeds, callouts, code, math) remains intact and generated Markdown can be edited in Obsidian Source mode. Canvas receives structural graph validation. Bases queries evaluate saved filters, formulas and view ordering through a bundled standalone expression engine; `bases capabilities` describes its compatibility profile. Images, audio, video and PDF are read, copied, replaced and exported as bytes/base64. Rendering, media transformations, PDF text editing and community-plugin semantics require extensions. See the precise [format contract](docs/reference/formats.md).

## Edit safely

Confirm the selection with `project current`, then read the file and verify its response's `context.root`. Copy `data.revision` into `--if-match`:

```sh
node bin/forge.js properties notes/plan.md --set '{"status":"draft","tags":["engineering"]}' --if-match YOUR_REVISION --dry-run
node bin/forge.js properties notes/plan.md --set '{"status":"draft","tags":["engineering"]}' --if-match YOUR_REVISION
```

Use `--stdin` for multiline text or binary input. After applying, read the file again and run `validate notes/plan.md`; a successful write is separate from verification of its intended content. For example:

```sh
node bin/forge.js write assets/diagram.png --stdin < diagram.png
node bin/forge.js create plan.canvas
node bin/forge.js create tasks.base
```

Existing files cannot be overwritten without their current revision. A conflict requires rereading and reconciling the change. Dry runs validate the same input, check `--if-match` like the real write, and report planned hashes, paths and a unified `diff` per text file without writing files or emitting `vault.*` events. Responses carry only committed Obsidian-style `vault.*` change events by default; add `--events all` for the full lifecycle history, including `workspace.*` analogues such as `workspace.quick-preview`. See [dry-run diffs](docs/reference/cli.md#dry-run-diffs).

If a write reports `WORKSPACE_BUSY`, another writer is active or a lock's holder cannot be verified. A lock left by a process that provably no longer runs on this host (killed, crashed, or from before a restart) is removed automatically with a warning. `error.details.lock` names the holder's pid, host, start time and command, `error.details.path` the lock file, and `error.details.stale` reports `active` (the holder runs or another writer is removing the stale lock: wait and retry), `unknown` (the holder cannot be verified, `retryable: false`) or `stale` (the holder provably no longer runs but removing the lock failed, `retryable: false`); follow the [write and recovery contract](docs/reference/cli.md#write-contract) before deleting an `unknown` or `stale` lock.

## Documentation

Use the [documentation hub](docs/index.md) to choose a learning path or find an exact contract. The docs follow Diátaxis:

- **Tutorials:** [getting started](docs/tutorials/getting-started.md), [your first UI](docs/tutorials/first-ui.md), and [idea to production](docs/tutorials/idea-to-production.md).
- **How-to guides:** [manage projects](docs/how-to/manage-projects.md), [regenerate components](docs/how-to/manage-components.md), [develop and test](docs/how-to/develop-and-test.md), and [build a release](docs/how-to/release.md).
- **Reference:** [CLI](docs/reference/cli.md), [configuration](docs/reference/configuration.md), [component definitions](docs/reference/ui-components.md), [Storybook](docs/reference/storybook.md), and [plugins](docs/reference/plugins.md).
- **Explanation:** [architecture](docs/explanation/architecture.md) and [deterministic generation](docs/explanation/deterministic-ui.md).

The [idea-to-production example pack](docs/examples/idea-to-production/README.md) includes filled-in discovery, requirements, design, implementation, testing and production artifacts. [Agent skills](../skills/forge-workflow/SKILL.md) and the [runnable example plugin](docs/examples/plugins/quality/main.mjs) support day-to-day use.

## Showcase

The repository commits `src/forge-showcase`, a fully generated managed project for Trailhead, a small fictional trip-planning web app. It shows the capabilities above working together: workflow documents linked into an Obsidian knowledge graph with Canvas and Bases, components and interactions generated for all seven UI targets with Storybook stories, data sources with adapters and fixtures, domain and application code, forms, a Claude agent, agent skills and the project's own toolchain and CI workflow. Open `src/forge-showcase` as an Obsidian vault and start at `docs/Trailhead.md`; its `README.md` maps each folder to the commands that produced it.

Run these from `src/the-forge`; the showcase stays a sibling project at `<workspace>/src/forge-showcase`:

```sh
npm run showcase        # regenerate src/forge-showcase through the workspace's bundled CLI
npm run showcase:check  # regenerate in a temporary workspace and report drift
```

See [explore the showcase](docs/how-to/explore-the-showcase.md) for browsing, the project's own checks and the lockfile step.

## Source organization

The repository is a thin Forge workspace. Its root holds only the shipped `bin/` distribution, generated `.github/workflows/`, the workspace `README.md`, `AGENTS.md`, `LICENSE` and Git settings. Every managed project under `src` is self-contained, with its own toolchain, tests and CI workflows.

The Forge itself is the project `src/the-forge`. It owns `package.json`, the lockfile, TypeScript/Vite/Vitest configuration, `scripts/`, `configs/`, `tests/`, these Diátaxis `docs/`, the authored agent `skills/<id>/SKILL.md` folders and the agent evaluation tasks in `evals/` ([evaluate agents](docs/how-to/evaluate-agents.md)). Runtime source lives in `src/the-forge/src`: the kernel uses domain, application, infrastructure and presentation layers divided into concern folders, and bundled core plugins live in `src/plugins/<id>/` with their own layers; `src/main.ts` composes the CLI, `src/server-main.ts` composes the detached server, and `src/sdk.ts` exposes plugin types. The independent `src/forge-admin` project owns the Vue/Nuxt UI frontend and its Playwright tests; Forge consumes only its packaged assets through the shared distribution. Examples live in `docs/examples`, and authored workflow/project templates in `docs/templates`; editable runtime templates remain in the workspace's `bin/templates`. Run npm commands from `src/the-forge`. Its `src/README.md` maps entry points; the [architecture](docs/explanation/architecture.md) explains dependency rules.

`npm run build` writes the launcher `bin/forge.js`, the runtime bundle `bin/forge-runtime.js`, the detached server `bin/forge-server.cjs` and the packaged assets into the workspace `bin/` named by `config.distribution` in `package.json` (`../../bin`). Forge's own CI is authored in `src/infrastructure/workflows/<concern>/`, like every managed project's workflows; `node bin/forge.js workflows sync` generates the workspace `.github/workflows` entrypoints from them. See [workflows](docs/reference/workflows.md).

This checkout manages its own source as a Forge project. Tracked `bin/config.json` sets `paths.projects` to `src`, `src/the-forge/.forge/project.json` identifies the project, and `bin/data/context.json` selects `the-forge`. Verify it from the workspace root before using project-relative paths:

```sh
node bin/forge.js project current --json
node bin/forge.js project open the-forge
node bin/forge.js read src/main.ts --json
node bin/forge.js make entity SourceProbe --out src/domain/example --dry-run
```

File commands resolve relative to the project root `src/the-forge`, so `read README.md` reads this file and `read src/main.ts` reads the runtime entry. Generators use the same project-relative paths as any generated project: `--out src/domain/<concern>` targets a source layer concern. `project close` returns file commands to the workspace root; `project open the-forge` restores project scope. Builds preserve this checkout configuration and selection. Released bundles keep generic `projects` defaults and no saved selection. Forge's quality checks cover only this project, leaving sibling managed projects under `src` to their own toolchains.

## Develop

```sh
cd src/the-forge
npm ci
npm run check:fast
npm run check
npm run release
```

`check:fast` checks source/test structure, then runs Oxlint, fallow, TypeScript and the source-only `check:contracts` suites during development. Run `npm run check:contracts` directly for command metadata, discovery, localization, documentation and evaluation-budget feedback without building the distribution. `check` adds a fresh build and the labeled unit, integration and end-to-end tests. Fix the cause of a failing stage, rerun it, then finish with `check`; see the [development feedback loop](docs/how-to/develop-and-test.md#agent-feedback-loop). Stryker mutation testing of selected domain code against the unit tests runs in CI only, in the advisory mutation workflow; it is not part of `check`. `npm run mutate` runs it locally to investigate surviving mutants and writes reports to `.quality-reports/mutation/`. See [mutation testing](docs/how-to/develop-and-test.md#mutation-testing). Commit source and the rebuilt workspace `bin` distribution together. The checkout tracks its self-management configuration and selection; installed plugins, editable templates and other workspaces' local context remain operating data. The CLI bundle needs only Node; developing The Forge or a generated project requires its development dependencies, including native Oxlint/fallow binaries.

Maintainers plan in the [product research](https://github.com/Luis85/agent-cli/tree/main/src/the-forge/docs/research): perspective reports on the product, the next iteration plan with its milestones and the record of how they shipped, and the reference contracts of backlog-view and docker-agent. The folder lives in `docs/research/`; it is planning material, not product documentation, so `npm run build` leaves it out of the packaged `bin/data/docs`.

MIT licensed. This is an independent tool, not an official Obsidian CLI.

