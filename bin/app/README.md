# The Forge

A portable Node CLI for AI-assisted engineering, TypeScript projects and Obsidian-compatible files. Built with strict TypeScript, Vite and Vitest. The Forge runs without Obsidian, npm installation, or runtime packages in your project.

## Use the committed bundle

Requires **Node 22.12 or newer**. Copy the entire `bin/app` directory and `bin/config.json` into your project's `bin` folder. The `app.cjs` entry point contains all runtime dependencies. The directory also includes its entry-point manifest, documentation, skills, type declarations, and license notices.

```sh
node bin/app --help
node bin/app schema --json
node bin/app config --json
node bin/app setup --dry-run
node bin/app setup
node bin/app project create knowledge-core --dry-run
node bin/app project create knowledge-core
node bin/app project component knowledge-core WorkItem --kind domain
node bin/app make entity WorkItem --out src/domain --dry-run
node bin/app make entity WorkItem --out src/domain
node bin/app create notes/plan.md --content '# Development plan'
node bin/app read notes/plan.md --json
```

`setup` initializes missing app/config files, an example template, three process skills and a lean `AGENTS.md`, preserving existing destinations. Edit `bin/config.json` to configure project, template, output, generated-code, plugin and skill paths and explicitly enable plugins. The CLI never prompts. All responses are JSON; `--json` makes them compact. Put routing options before the command: `node bin/app --root /path/to/project setup`. See [configuration](docs/configuration.md) and [project workflows](docs/projects.md).

To download the current committed bundle as part of the repository archive:

```sh
curl -fL https://github.com/Luis85/agent-cli/archive/refs/heads/main.tar.gz -o agent-cli-source.tar.gz
tar -xzf agent-cli-source.tar.gz
mkdir -p bin
cp -R agent-cli-main/bin/app bin/
cp agent-cli-main/bin/config.json bin/config.json
node bin/app --version
```

This URL serves the remote `main` branch after the implementation is pushed there. For a fixed version, use a reviewed commit archive instead. Maintainers can produce a smaller `release/forge-0.1.0.tar.gz` with `npm run release`; extracting that archive in a project places the app at `bin/app` and defaults at `bin/config.json`. Releases are not automatically published. For an upgrade, extract into a temporary directory, replace the app directory, and review configuration changes before replacing your existing settings.

## Capabilities

- `make`: TypeScript entity, value object, use case and event scaffolds; Obsidian-inspired plugin directories; Markdown documents from frontmatter-aware templates. Plugins contribute more generators without rebuilding the CLI.
- `templates`, `config`: inspect template inputs and effective project configuration before generating documents.
- `setup`, `project`: initialize a workspace, discover independent TypeScript libraries and add domain or application components.
- `create`, `read`, `write`, `edit`, `properties`, `patch`, `validate`, `list`: Markdown/YAML properties, JSON Canvas graphs, Bases YAML, and lossless attachment handling.
- `schema`, `help`, `formats`, `events`, `plugins`: discover the installed contracts and capabilities.
- `skills`: inspect and install agent workflows for safe file editing, feature development and verification.
- Explicit runtime plugins: manifest discovery, `onload`/`onunload`, commands, generators, validated events and skills.
- SHA-256 revision checks, dry-run previews, contained paths, collision checks and notifications after successful commits.

Markdown syntax (wikilinks, embeds, callouts, code, math) remains intact. Canvas receives structural graph validation; Bases receive structural YAML validation and preserve expressions as data. Images, audio, video and PDF are read, copied, replaced and exported as bytes/base64. Rendering, media transformations, PDF text editing, Obsidian's query engine, and community-plugin semantics require extensions. See the precise [format contract](docs/formats.md).

## Edit safely

Read the file first. Copy `data.revision` into `--if-match`:

```sh
node bin/app properties notes/plan.md --set '{"status":"draft","tags":["engineering"]}' --if-match YOUR_REVISION --dry-run
node bin/app properties notes/plan.md --set '{"status":"draft","tags":["engineering"]}' --if-match YOUR_REVISION
```

Use `--stdin` for multiline text or binary input. For example:

```sh
node bin/app write assets/diagram.png --stdin < diagram.png
node bin/app create plan.canvas
node bin/app create tasks.base
```

Existing files cannot be overwritten without their current revision. A conflict requires rereading and reconciling the change. Dry runs validate the same input and report planned hashes and paths without writing files or emitting file events.

## Documentation

- [Command reference and agent protocol](docs/cli.md)
- [Project configuration](docs/configuration.md)
- [Markdown templates](docs/templates.md)
- [Workspace setup and TypeScript projects](docs/projects.md)
- [Supported formats and limitations](docs/formats.md)
- [Plugin API and event lifecycle](docs/plugins.md)
- [Architecture and reference patterns](docs/architecture.md)
- [Development, testing and distribution](docs/development.md)
- [Agent process skills](skills/forge-workflow.md)
- [Runnable example plugin](examples/plugins/quality/main.mjs)

## Develop

```sh
npm ci
npm run check
npm run release
```

`check` type-checks, rebuilds `bin/app`, and runs unit, architecture, filesystem and standalone CLI tests. Commit source and the rebuilt `bin/app` together. Dependencies are needed only to develop the CLI; generated TypeScript belongs to the target project's toolchain.

MIT licensed. This is an independent tool, not an official Obsidian CLI.
