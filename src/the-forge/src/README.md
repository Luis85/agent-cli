# Source map

This directory is the Forge project's runtime source root: `src` inside the project `src/the-forge`. It uses layer directories with concern folders inside each layer. Start with the responsibility of a change, then choose the concern that owns it. Add a concern only to layers that need it. The [architecture explanation](../docs/explanation/architecture.md) describes the contracts and their limits; the [development guide](../docs/how-to/develop-and-test.md) describes verification.

The workspace's `bin/forge.js` selects this project through tracked workspace configuration and context, and file commands resolve relative to the project root one directory above this file. `read src/README.md` therefore reads this file and `read src/main.ts` the composition root. Inspect `project current` before editing; generators use project-relative layer paths such as `make entity SourceProbe --out src/domain/example --dry-run`. The project marker is `../.forge/project.json`. Package installation, builds and tests run from the project root, which owns `package.json`, the lockfile, `tests/`, `scripts/`, `configs/`, `docs/` and `skills/`.

| Layer | Put here | Dependencies |
| --- | --- | --- |
| `domain/` | Pure definitions, validation, path rules and analysis | Domain only; no Node or external packages |
| `application/` | Use cases, ports, orchestration and extension contracts | Application and domain; no Node or external packages |
| `infrastructure/` | Filesystem and process adapters, codecs, rendering and generation implementations | Infrastructure, application and domain |
| `presentation/` | CLI parsing, command handlers, input/output translation and scope policy | Presentation, application and domain; Commander owns CLI grammar |

Bundled **core plugins** live in `plugins/<id>/`, each a self-contained slice with its own `domain/`, `application/`, `infrastructure/` and `presentation/` folders (files directly in the layer folder or in subfolders) and a `plugin.ts` entry exporting its `CorePlugin`:

| Location | Put here | Dependencies |
| --- | --- | --- |
| `plugins/<id>/<layer>/` | The plugin's own rules, use cases, adapters and commands | The plugin's layers by the table above, plus kernel `domain/` (and kernel `application/` above domain) |
| `plugins/<id>/plugin.ts` | Manifest (`core: true`) and `create(host)`, which wires the plugin's layers to injected kernel ports without I/O | The plugin's four layers, kernel `domain/` and `application/` |

A core plugin never imports kernel infrastructure or presentation, or another plugin; plugins cooperate through declared services. Kernel code never imports `plugins/`. [main.ts](main.ts) imports each `plugin.ts`, lists it in `corePlugins` and passes the `CorePluginHost` ports; when a plugin needs another kernel capability, add a port to `CorePluginHost` in `application/plugins/core-plugins.ts` and supply it from `main.ts`. Tests for a core plugin live in `tests/<id>/`.

Import the concrete module you need. Do not add layer barrels, re-export chains or compatibility files at previous locations. Infrastructure and presentation do not import one another: application ports and [main.ts](main.ts) connect them. Presentation's package metadata import supports version/discovery output; it does not grant access to arbitrary external modules.

## Entry points

- [main.ts](main.ts) composes adapters and application services, creates invocation contexts, loads enabled plugins and owns cleanup and response serialization.
- [sdk.ts](sdk.ts) exports application/domain types for plugin authors. It contains no runtime behavior; packaging generates the distributable declarations.
- [cli/commands.ts](presentation/cli/commands.ts) assembles command families; [catalog-commands.ts](presentation/cli/catalog-commands.ts) handles discovery.
- [command-metadata.ts](application/plugins/command-metadata.ts) defines the declarative command metadata (scope, discovery, mutating, options, arguments, actions, errors) and the JSON Schema that `schema` publishes; [invocation-policy.ts](presentation/cli/invocation-policy.ts) derives workspace/project scope, plugin activation and explicit project selection from it before services are bound.
- [workspace.ts](application/workspace/workspace.ts) owns guarded file mutations, dry-run plans and notifications after persistence.
- [registry.ts](application/plugins/registry.ts) owns plugin contracts and registered contributions, with [contributions.ts](application/plugins/contributions.ts) validation, [plugin-services.ts](application/plugins/plugin-services.ts) dependency order, [plugin-settings.ts](application/plugins/plugin-settings.ts) config sections and [plugin-catalog.ts](application/plugins/plugin-catalog.ts) strings and error codes; [core-plugins.ts](application/plugins/core-plugins.ts) registers bundled core plugins; [claude-lifecycle.ts](application/plugins/claude-lifecycle.ts) declares the types of the `claude.lifecycle` service that the `claude` plugin implements and the SDK publishes; [loader.ts](infrastructure/plugins/loader.ts) loads trusted user plugin modules.
- The bundled core plugins, in the order [main.ts](main.ts) registers them: [templates](plugins/templates/plugin.ts) (Markdown templates, `make document` and the workflow pack), [scaffolds](plugins/scaffolds/plugin.ts) (code generators, forms, plugin folders and project scaffolds), [ui](plugins/ui/plugin.ts) (component and interaction libraries, UI and Storybook generation), [data-sources](plugins/data-sources/plugin.ts) (data-source definitions, typed adapters and fixtures), [claude](plugins/claude/plugin.ts) (native Claude Code management, the installed CLI lifecycle and the `claude.lifecycle` service), [bases](plugins/bases/plugin.ts) (Bases queries), [skills](plugins/skills/plugin.ts) (the bundled agent skills and the `skills` command), [search](plugins/search/plugin.ts) (text search), [links](plugins/links/plugin.ts) (link reports), [agents](plugins/agents/plugin.ts) (docker-agent definitions and Claude Code agent generation), [connector](plugins/connector/plugin.ts) (connection profiles and the `connector.hub` service), [connector-azure-devops](plugins/connector-azure-devops/plugin.ts) (Azure DevOps Boards) and [backlog](plugins/backlog/plugin.ts) (backlog-view compatible product backlogs and their sync engine).

## Find the concern

| Concern | Starting points |
| --- | --- |
| File formats and editing | `domain/documents/`, `application/workspace/`, `infrastructure/documents/`, `presentation/documents/` |
| Workspace configuration and setup | `application/workspace/`, `infrastructure/workspace/`, `presentation/workspace/` |
| Projects (selection, `project create`/`component` policy) | `application/projects/`, `presentation/workspace/` |
| Code, form, plugin-folder and project scaffolds (`scaffolds` core plugin, service `scaffolds.projects`) | `plugins/scaffolds/` |
| Markdown templates, `make document` and the workflow pack (`templates` core plugin, service `templates.installer` for `setup`) | `plugins/templates/` |
| Plugins and event delivery | `application/plugins/`, `infrastructure/plugins/`, `presentation/cli/catalog-commands.ts` |
| Claude definitions and installed CLI (`claude` core plugin) | `plugins/claude/`; the agent and hook validators shared with `agents` stay in `domain/claude/` |
| UI and interaction definitions (`ui` core plugin) | `plugins/ui/`: `domain/components/` and `domain/interactions/` (definitions, library graph, binding syntax), `application/` (library use cases and `plugins.settings.ui`), `infrastructure/` (Markdown codecs), `presentation/` (`components`, `interactions`, `make ui`, `make stories`) |
| Framework output | `plugins/ui/infrastructure/components/renderers/`, `plugins/ui/infrastructure/components/interactions/` (handler emission) and `plugins/ui/infrastructure/components/stories.ts` |
| Data sources (`data-sources` core plugin) | `plugins/data-sources/`: `domain/definition.ts`, `application/` (library use cases and `plugins.settings.data-sources`), `infrastructure/` (Markdown codec, TypeScript adapter and fixture renderer), `presentation/commands.ts` (`data-sources`, `make data-source`) |
| Vault metadata cache: links, tags, headings, blocks and resolution | `domain/metadata/`, `application/metadata/`, `infrastructure/metadata/` |
| Moves, renames and deletion with link updates; the Obsidian-shaped `app` facade | `domain/metadata/link-text.ts`, `application/vault/`, `infrastructure/workspace/batch.ts`, `presentation/documents/vault-commands.ts` |
| Bases queries (`bases` core plugin) | `plugins/bases/` |
| Generation | `application/generation/` (the shared review controls, library generation options and `GenerationService` that `make`, the plugin generators and `agents generate` use) and `presentation/generation/` (`make` routing over the generators plugins contribute) |
| Agent skills (`skills` core plugin) | `plugins/skills/` |
| Link reports (`links` core plugin) | `plugins/links/` |
| docker-agent definitions and generated Claude agents (`agents` core plugin) | `plugins/agents/`: semantic rules and the Claude mapping in `domain/`, the vendored schema and its source commit in `infrastructure/vendor/` (refreshed by `npm run vendor:docker-agent`) |
| Product backlogs (`backlog` core plugin): settings from `.base` view options, the hierarchy and rank model, refusals and writes | `plugins/backlog/domain/` (pure backlog-view rules), `plugins/backlog/application/` (session, writes, use cases), `plugins/backlog/infrastructure/` (YAML), `plugins/backlog/presentation/command.ts` |
| Backlog sync engine: bound views, three-way field comparison, `.forge/sync` state and guarded pulls | `plugins/backlog/domain/sync-*.ts`, `plugins/backlog/application/sync*.ts`, `plugins/backlog/presentation/sync-command.ts` |
| Connector contract, neutral remote items and the HTTP transport | `application/connectors/`, `domain/connectors/`, `infrastructure/connectors/http-client.ts` |
| Connection profiles and the `connector.hub` service (`connector` core plugin); Azure DevOps Boards (`connector-azure-devops` core plugin) | `plugins/connector/`, `plugins/connector-azure-devops/` |
| Text search (`search` core plugin) | `plugins/search/`; path globs and cursor paging shared with `list` in `domain/documents/path-glob.ts` and `domain/shared/paging.ts` |
| Plugin contract v2: command metadata, core plugins, services, config sections, strings and error codes | `application/plugins/` (with `library-commands.ts` for Markdown definition library commands), `domain/schema/json-schema.ts`, `presentation/cli/catalog-commands.ts` |
| Project-owned CI workflows and generated GitHub entrypoints | Matching `workflows/` folders in all four layers; authored workflow sources sit beside the renderer in `infrastructure/workflows/<concern>/` |
| Shared failures, the error catalog and localized responses | `domain/shared/errors.ts`, `domain/shared/error-catalog.ts`, `presentation/localization/` |

Pure interaction analysis belongs in domain. JavaScript, CSS and framework handler emission belongs in infrastructure. Command handlers translate user input and invoke services rather than constructing filesystem/process adapters or duplicating their validation.

## Templates, tooling and checks

[docs/templates/projects/](../docs/templates/projects/) contains generated-project source and static assets consumed by the `scaffolds` plugin's [projects.ts](plugins/scaffolds/infrastructure/projects.ts); the `templates` plugin's [pack.ts](plugins/templates/infrastructure/pack.ts) embeds the workflow templates. [Workflow templates](../docs/templates/workflow/) and [examples](../docs/examples/) are also authored under `docs/`. Template code describes a generated application; it is not a Forge domain object or a second runtime entry point. Editable workspace templates remain under the workspace's `bin/templates/`.

The project's build/release/quality programs live in [../scripts/](../scripts/). Versioned tooling and distribution policies live in [../configs/](../configs/). Authored agent skills live in [../skills/](../skills/) and are packaged into the workspace `bin/skills/`. Configuration and the portable distribution live under the workspace `bin/`, which `config.distribution` in `package.json` names; update source and regenerate owned distribution files without replacing active settings. This checkout tracks a configuration with `paths.projects: "src"` and a saved `the-forge` selection. Release packaging uses generic defaults and excludes that selection.

The project's CI is authored in [infrastructure/workflows/](infrastructure/workflows/): `check/check.yml` is the full matrix gate and `guard/workflows.yml` fails pull requests whose generated workflows drift. They are workflow sources, not runtime code; `workflows sync` generates the workspace's `.github/workflows` entrypoints from them. The `workflows` command family itself follows the layers: `domain/workflows/`, `application/workflows/`, `infrastructure/workflows/renderer.ts` and `presentation/workflows/`.

`configs/quality/source.json` selects the project's `src` as Forge's source inventory and `docs/examples` / `docs/templates` as additional authored-code roots. Sibling managed projects live outside this project and are never swept into its checks. `npm run check:structure` enables `--source-layout forge` to enforce layers and concern directories within that source root. Generated projects use the same checker without that option and retain their own `src` inventory and scaffold layout. Architecture tests independently check inward imports across all four layers and the SDK's type-only boundary. Use the focused tests for a change, then follow the repository's complete development check sequence before finishing.
