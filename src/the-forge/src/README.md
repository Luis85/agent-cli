# Source map

This directory is the Forge project's runtime source root, `src/the-forge`. It uses layer directories with concern folders inside each layer. Start with the responsibility of a change, then choose the concern that owns it. Add a concern only to layers that need it. The [architecture explanation](../../docs/explanation/architecture.md) describes the contracts and their limits; the [development guide](../../docs/how-to/develop-and-test.md) describes verification.

The repository's `bin/app.js` selects this project through tracked workspace configuration and context. `read README.md` therefore reads this file. Inspect `project current` before editing, and use an explicit output such as `make entity SourceProbe --out domain/example --dry-run`; the generic `src/domain` default would nest another source directory here. The project marker is `.forge/project.json`. Package installation, builds and tests still run from the repository root, two directories above this file; this source project does not duplicate that toolchain.

| Layer | Put here | Dependencies |
| --- | --- | --- |
| `domain/` | Pure definitions, validation, path rules and analysis | Domain only; no Node or external packages |
| `application/` | Use cases, ports, orchestration and extension contracts | Application and domain; no Node or external packages |
| `infrastructure/` | Filesystem and process adapters, codecs, rendering and generation implementations | Infrastructure, application and domain |
| `presentation/` | CLI parsing, command handlers, input/output translation and scope policy | Presentation, application and domain; Commander owns CLI grammar |

Import the concrete module you need. Do not add layer barrels, re-export chains or compatibility files at previous locations. Infrastructure and presentation do not import one another: application ports and [main.ts](main.ts) connect them. Presentation's package metadata import supports version/discovery output; it does not grant access to arbitrary external modules.

## Entry points

- [main.ts](main.ts) composes adapters and application services, creates invocation contexts, loads enabled plugins and owns cleanup and response serialization.
- [sdk.ts](sdk.ts) exports application/domain types for plugin authors. It contains no runtime behavior; packaging generates the distributable declarations.
- [cli/commands.ts](presentation/cli/commands.ts) assembles command families; [catalog-commands.ts](presentation/cli/catalog-commands.ts) handles discovery.
- [invocation-policy.ts](presentation/cli/invocation-policy.ts) decides workspace/project scope, whether plugins should activate and explicit project selection before services are bound.
- [workspace.ts](application/workspace/workspace.ts) owns guarded file mutations, dry-run plans and notifications after persistence.
- [registry.ts](application/plugins/registry.ts) owns plugin contracts and registered contributions; [loader.ts](infrastructure/plugins/loader.ts) loads trusted modules.

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
| Bases queries | `application/bases/`, `infrastructure/bases/`, `presentation/bases/` |
| Generators, templates and skills | `application/generation/`, `application/templates/`, corresponding infrastructure concerns and `presentation/generation/` / `presentation/skills/` |
| Shared failures, the error catalog and localized responses | `domain/shared/errors.ts`, `domain/shared/error-catalog.ts`, `presentation/localization/` |

Pure interaction analysis belongs in domain. JavaScript, CSS and framework handler emission belongs in infrastructure. Command handlers translate user input and invoke services rather than constructing filesystem/process adapters or duplicating their validation.

## Templates, tooling and checks

[docs/templates/projects/](../../docs/templates/projects/) contains generated-project source and static assets consumed by [scaffolds.ts](infrastructure/projects/scaffolds.ts). [Workflow templates](../../docs/templates/workflow/) and [examples](../../docs/examples/) are also authored under `docs/`. Template code describes a generated application; it is not a Forge domain object or a second runtime entry point. Editable workspace templates remain under root `bin/templates/`.

Repository build/release/quality programs live in [../../scripts/](../../scripts/). Versioned tooling and distribution policies live in [../../configs/](../../configs/). Configuration and the portable distribution live under root `bin/`; update source and regenerate owned distribution files without replacing active settings. This checkout tracks a configuration with `paths.projects: "src"` and a saved `the-forge` selection. Release packaging uses generic defaults and excludes that selection.

`configs/quality/source.json` at the repository root selects `src/the-forge` as Forge's source inventory and `docs/examples` / `docs/templates` as additional authored-code roots. Other managed projects under `src` are not swept into its checks. `npm run check:structure` enables `--source-layout forge` to enforce layers and concern directories within that source root. Generated projects use the same checker without that option and retain their own `src` inventory and scaffold layout. Architecture tests independently check inward imports across all four layers and the SDK's type-only boundary. Use the focused tests for a change, then follow the repository's complete development check sequence before finishing.
