# The Forge

A portable Node CLI for AI-assisted engineering, TypeScript projects and Obsidian-compatible files. Built with strict TypeScript, Vite and Vitest. The Forge runs without Obsidian, npm installation, or runtime packages in your project.

## Use the committed bundle

Requires **Node 22.12 or newer**. Copy the complete `bin` distribution into your workspace. Run `node bin/app.js`; the executable contains all runtime dependencies. Keep `bin/package.json` beside it so the app runs in ESM and CommonJS parent projects. Authored process skills live in `bin/skills`; packaged documentation, type declarations and notices live in `bin/data`. Shipped defaults live in `bin/config/default.json`; active workspace settings remain in `bin/config.json`.

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

To download the committed distribution from the repository into a new workspace:

```sh
curl -fL https://github.com/Luis85/agent-cli/archive/refs/heads/main.tar.gz -o agent-cli-source.tar.gz
tar -xzf agent-cli-source.tar.gz
cp -R agent-cli-main/bin ./bin
node bin/app.js --version
node bin/app.js setup
```

This URL serves the latest `main` branch. For a fixed version, use a reviewed commit archive instead. Maintainers can produce `release/forge-0.1.0.tar.gz` with `npm run release`; extracting it places the complete distribution in `bin`. Releases are not automatically published. For an existing installation, extract separately and preserve configuration, shared plugins/templates and project selection when updating the executable and packaged assets.

## Capabilities

- `make`: TypeScript entity, value object, use case and event scaffolds; typed form definitions with validation and HTML rendering; Obsidian-inspired plugin directories; Markdown documents from frontmatter-aware templates. Plugins contribute more generators without rebuilding the CLI.
- `components`, `interactions`, `make ui`, `make stories`: maintain Markdown/frontmatter component libraries and generate deterministic HTML, HTMX, vanilla JS, Vue, Svelte, React or Angular boilerplate with Storybook CSF stories and native extension modules. Shared interaction definitions generate typed local state and executable browser-event actions across all seven targets; see [interactions](docs/reference/interactions.md) and [UI components](docs/reference/ui-components.md).
- `templates`, `config`: inspect template inputs and effective configuration; install editable PRD, use-case, build-spec, design, implementation, test and release templates.
- `data-sources`, `make data-source`: manage Markdown-defined REST/local JSON data sources and generate deterministic TypeScript adapters; see [data sources](docs/reference/data-sources.md).
- `setup`, `project`: initialize a workspace, discover and select independent TypeScript libraries, and add domain or application components.
- `create`, `read`, `write`, `edit`, `properties`, `patch`, `validate`, `list`: Markdown/YAML properties, JSON Canvas graphs, Bases YAML, and lossless attachment handling.
- `schema`, `help`, `formats`, `events`, `plugins`: discover the installed contracts and capabilities.
- `skills`: inspect and install agent workflows for safe file editing, feature development and verification.
- Explicit runtime plugins: manifest discovery, `onload`/`onunload`, commands, generators, validated events and skills.
- SHA-256 revision checks, dry-run previews, contained paths, collision checks and notifications after successful commits.

Markdown syntax (wikilinks, embeds, callouts, code, math) remains intact. Canvas receives structural graph validation; Bases receive structural YAML validation and preserve expressions as data. Images, audio, video and PDF are read, copied, replaced and exported as bytes/base64. Rendering, media transformations, PDF text editing, Obsidian's query engine, and community-plugin semantics require extensions. See the precise [format contract](docs/reference/formats.md).

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

Existing files cannot be overwritten without their current revision. A conflict requires rereading and reconciling the change. Dry runs validate the same input and report planned hashes and paths without writing files or emitting file events.

If a write reports `WORKSPACE_BUSY`, another writer may still be active or an interrupted process may have left a lock. Follow the [write and recovery contract](docs/reference/cli.md#write-contract) before removing it.

## Documentation

Use the [documentation hub](docs/index.md) to choose a learning path or find an exact contract. The docs follow Diátaxis:

- **Tutorials:** [getting started](docs/tutorials/getting-started.md), [your first UI](docs/tutorials/first-ui.md), and [idea to production](docs/tutorials/idea-to-production.md).
- **How-to guides:** [manage projects](docs/how-to/manage-projects.md), [regenerate components](docs/how-to/manage-components.md), [develop and test](docs/how-to/develop-and-test.md), and [build a release](docs/how-to/release.md).
- **Reference:** [CLI](docs/reference/cli.md), [configuration](docs/reference/configuration.md), [component definitions](docs/reference/ui-components.md), [Storybook](docs/reference/storybook.md), and [plugins](docs/reference/plugins.md).
- **Explanation:** [architecture](docs/explanation/architecture.md) and [deterministic generation](docs/explanation/deterministic-ui.md).

The [idea-to-production example pack](examples/idea-to-production/README.md) includes filled-in discovery, requirements, design, implementation, testing and production artifacts. [Agent skills](../skills/forge-workflow.md) and the [runnable example plugin](examples/plugins/quality/main.mjs) support day-to-day use.

## Develop

```sh
npm ci
npm run check:fast
npm run check
npm run release
```

`check:fast` checks source/test structure, then runs Oxlint, fallow and TypeScript checks during development. `check` adds a fresh build and the labeled unit, integration and end-to-end tests. Fix the cause of a failing stage, rerun it, then finish with `check`; see the [development feedback loop](docs/how-to/develop-and-test.md#agent-feedback-loop). Commit source and the rebuilt `bin` distribution together; local context, plugins and templates are runtime data. The CLI bundle needs only Node; developing The Forge or a generated project requires its development dependencies, including native Oxlint/fallow binaries.

MIT licensed. This is an independent tool, not an official Obsidian CLI.
