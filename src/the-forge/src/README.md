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
- [registry.ts](application/plugins/registry.ts) owns plugin contracts and registered contributions, with [contributions.ts](application/plugins/contributions.ts) validation, [plugin-services.ts](application/plugins/plugin-services.ts) dependency order, [plugin-settings.ts](application/plugins/plugin-settings.ts) config sections and [plugin-catalog.ts](application/plugins/plugin-catalog.ts) strings and error codes; [core-plugins.ts](application/plugins/core-plugins.ts) registers bundled core plugins; [loader.ts](infrastructure/plugins/loader.ts) loads trusted user plugin modules.
- [plugins/skills/plugin.ts](plugins/skills/plugin.ts) is the first core plugin: the bundled agent skills and the `skills` command.

## Find the concern

| Concern | Starting points |
| --- | --- |
| File formats and editing | `domain/documents/`, `application/workspace/`, `infrastructure/documents/`, `presentation/documents/` |
| Workspace configuration and setup | `application/workspace/`, `infrastructure/workspace/`, `presentation/workspace/` |
| Projects and scaffolding | `application/projects/`, `infrastructure/projects/`, `presentation/workspace/` |
| Plugins and event delivery | `application/plugins/`, `infrastructure/plugins/`, `presentation/cli/catalog-commands.ts` |
| Claude definitions and installed CLI | Matching `claude/` folders in all four layers |
| UI and interaction definitions | `domain/ui/`, `domain/interactions/` and matching application/infrastructure/presentation concerns |
| Framework output | `infrastructure/ui/renderers/` and `infrastructure/ui/interactions/` |
| Data sources | Matching `data-sources/` folders in all four layers |
| Vault metadata cache: links, tags, headings, blocks and resolution | `domain/metadata/`, `application/metadata/`, `infrastructure/metadata/` |
| Moves, renames and deletion with link updates; the Obsidian-shaped `app` facade | `domain/metadata/link-text.ts`, `application/vault/`, `infrastructure/workspace/batch.ts`, `presentation/documents/vault-commands.ts` |
| Bases queries (`bases` core plugin) | `plugins/bases/` |
| Generators and templates | `application/generation/`, `application/templates/`, corresponding infrastructure concerns and `presentation/generation/` (`make` routing and the kernel generators) |
| Agent skills (`skills` core plugin) | `plugins/skills/` |
| Text search (`search` core plugin) | `plugins/search/`; path globs and cursor paging shared with `list` in `domain/documents/path-glob.ts` and `domain/shared/paging.ts` |
| Plugin contract v2: command metadata, core plugins, services, config sections, strings and error codes | `application/plugins/`, `domain/schema/json-schema.ts`, `presentation/cli/catalog-commands.ts` |
| Project-owned CI workflows and generated GitHub entrypoints | Matching `workflows/` folders in all four layers; authored workflow sources sit beside the renderer in `infrastructure/workflows/<concern>/` |
| Shared failures, the error catalog and localized responses | `domain/shared/errors.ts`, `domain/shared/error-catalog.ts`, `presentation/localization/` |

Pure interaction analysis belongs in domain. JavaScript, CSS and framework handler emission belongs in infrastructure. Command handlers translate user input and invoke services rather than constructing filesystem/process adapters or duplicating their validation.

## Templates, tooling and checks

[docs/templates/projects/](../docs/templates/projects/) contains generated-project source and static assets consumed by [scaffolds.ts](infrastructure/projects/scaffolds.ts). [Workflow templates](../docs/templates/workflow/) and [examples](../docs/examples/) are also authored under `docs/`. Template code describes a generated application; it is not a Forge domain object or a second runtime entry point. Editable workspace templates remain under the workspace's `bin/templates/`.

The project's build/release/quality programs live in [../scripts/](../scripts/). Versioned tooling and distribution policies live in [../configs/](../configs/). Authored agent skills live in [../skills/](../skills/) and are packaged into the workspace `bin/skills/`. Configuration and the portable distribution live under the workspace `bin/`, which `config.distribution` in `package.json` names; update source and regenerate owned distribution files without replacing active settings. This checkout tracks a configuration with `paths.projects: "src"` and a saved `the-forge` selection. Release packaging uses generic defaults and excludes that selection.

The project's CI is authored in [infrastructure/workflows/](infrastructure/workflows/): `check/check.yml` is the full matrix gate and `guard/workflows.yml` fails pull requests whose generated workflows drift. They are workflow sources, not runtime code; `workflows sync` generates the workspace's `.github/workflows` entrypoints from them. The `workflows` command family itself follows the layers: `domain/workflows/`, `application/workflows/`, `infrastructure/workflows/renderer.ts` and `presentation/workflows/`.

`configs/quality/source.json` selects the project's `src` as Forge's source inventory and `docs/examples` / `docs/templates` as additional authored-code roots. Sibling managed projects live outside this project and are never swept into its checks. `npm run check:structure` enables `--source-layout forge` to enforce layers and concern directories within that source root. Generated projects use the same checker without that option and retain their own `src` inventory and scaffold layout. Architecture tests independently check inward imports across all four layers and the SDK's type-only boundary. Use the focused tests for a change, then follow the repository's complete development check sequence before finishing.
