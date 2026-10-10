# Architecture

[Documentation](../index.md) · Explanation

## Boundaries

The domain uses the terms **workspace**, **file snapshot**, **revision**, **write plan**, **generator**, and **committed change**. The filesystem is an adapter; Obsidian is not a runtime dependency. A workspace owns fixed `bin` resources and a configurable managed-project directory. Persistent project selection chooses the root for document commands and generators; shared templates/plugins and project management remain workspace-scoped. Command responses identify the executed scope. Revisions describe file content, not elapsed time or a globally ordered version.

Source is organized by layer, then by concern. For example, Claude definitions belong in `src/domain/claude`, their use cases and ports in `src/application/claude`, Node adapters in `src/infrastructure/claude`, and command translation in `src/presentation/claude`. A concern does not need a folder in every layer. Paths in this section are relative to the Forge project directory `src/the-forge`; its `src/README.md` maps entry points and placement examples.

The repository is a thin workspace whose managed projects are self-contained. The Forge is one of them: workspace configuration sets the managed-project directory to `src`, the marker `src/the-forge/.forge/project.json` identifies `the-forge`, and the persisted selection names it. File commands then resolve from the project root `src/the-forge`, exactly as in any generated project. The project owns its `package.json`, lockfile, compiler/build configuration, tests, scripts, policies, documentation and authored skills; its build writes the shipped distribution into the workspace `bin/` named by `config.distribution` in `package.json`. Sibling projects such as `src/forge-showcase` keep their own toolchains. Generic release defaults remain `projects` with no selection, and normal builds preserve the checkout's selected project.

Each project authors its CI workflows under `src/infrastructure/workflows/<concern>/`. The `workflows` command family discovers them in every managed project and synchronizes prefixed, path-scoped entrypoints into the workspace `.github/workflows/`; the authored files stay the single source of truth and drift fails CI. Discovery and the transformation are pure application/domain logic over the file repository port; the YAML codec is an infrastructure adapter. See [workflows](../reference/workflows.md).

| Location | Responsibility | Allowed source dependencies |
| --- | --- | --- |
| `src/domain/<concern>/` | Value contracts, path and document invariants, pure analysis, application errors | Domain |
| `src/application/<concern>/` | Use cases, injected ports, write orchestration, plugin registry and events | Application and domain |
| `src/infrastructure/<concern>/` | Filesystem/process adapters, codecs, module loading, templates and framework renderers | Infrastructure, application and domain |
| `src/presentation/<concern>/` | CLI grammar, command definitions, input/output translation and invocation policy | Presentation, application and domain |
| `src/main.ts` | Composition root: construct adapters, bind services, run the invocation and clean up | All layers |
| `src/sdk.ts` | Explicit public type exports for plugin authors | Application and domain types only |

Domain and application use no Node or external package imports. Infrastructure owns runtime dependencies such as filesystem access, YAML parsing and child processes. Presentation uses Commander for CLI grammar and package metadata for discovery, but does not import infrastructure or instantiate its adapters. Simple text encoding belongs with input translation; document codecs stay behind application ports. Composition supplies concrete services instead of using a global service locator.

Command families own their handlers: document editing, generation, skills, project/workspace operations, UI and Claude each have a presentation concern. `src/presentation/cli/commands.ts` only assembles these definitions in order; catalog commands own discovery responses. The pure `invocationPolicy` in `src/presentation/cli/invocation-policy.ts` decides workspace versus selected-project scope, plugin activation and explicit generated-project selection. `src/main.ts` applies that policy when binding services, so routing rules have one owner and recovery/discovery commands do not depend on a stale project selection.

Within Claude presentation, agent, hook and authored-plugin asset handlers live in `agents.ts`, `hooks.ts` and `plugin-assets.ts`. `commands.ts` dispatches among those handlers and the installed lifecycle service. Argument parsing and text encoding are presentation responsibilities; the concrete codec and process implementations remain in infrastructure.

The workspace use case owns validation and post-commit notifications; command handlers do not publish fake `vault.*` events, and plugins cannot emit host-owned events at all. Plugin generators return write plans instead of writing directly. Core event delivery failures become warnings because persistence has already succeeded.

## Source placement and enforcement

Import concrete modules directly. There are no layer barrels or compatibility modules at old locations. The explicit type-only SDK is the public plugin contract; it does not expose host startup or adapter implementations. Packaged declarations are generated from that contract and the types it references.

Runtime implementation and generated-project assets have different roles even when both use TypeScript. `src/infrastructure/projects/scaffolds.ts` produces project files from authored assets under `docs/templates/projects/`; reusable workflow documents live under `docs/templates/workflow/`. Those templates describe code or documents emitted into another project; they are not Forge domain models. Runnable examples live in `docs/examples/`. Infrastructure owns their loading and rendering, while framework-independent interaction selection and validation belong in domain. Installed, editable workspace templates remain in `bin/templates/`.

Build, release and quality programs live in the project's `scripts/`; versioned tooling and distribution policies live in its `configs/`. They are development inputs, separate from runtime adapters. Active user settings remain in the workspace `bin/config.json` and are preserved by builds. The committed workspace `bin` tree is the portable distribution, not an alternative source tree.

`configs/quality/source.json` selects the project's `src` as Forge's source inventory and `docs/examples` / `docs/templates` as additional authored-code roots; sibling managed projects live outside the project directory and are never scanned. `npm run check:structure` selects `--source-layout forge` to enforce layers and concern folders within that source root; lint enforces file-size limits. Generated projects reuse the structure tool without that option or repository policy, retaining their default `src` inventory and intended flat domain/application output. Architecture tests inspect TypeScript syntax recursively across all four layers, including side-effect imports, re-exports, type imports and dynamic imports. They enforce the dependency table and separately reject runtime exports or outward dependencies in `src/sdk.ts`. Location checks and import checks serve different purposes: placing a file in a domain directory does not make an adapter dependency acceptable.

The event bus receives an `EventDeliveryScope` port rather than importing Node's asynchronous context machinery. Its `NodeEventScope` adapter uses `AsyncLocalStorage` to track active delivery ancestry. Each invocation creates a fresh scope and bus. This separates recursive notification chains from independent concurrent work, preserves the recursion bound across `await`, and stops completed callbacks from retaining a recursion budget for later notifications.

`src/application/plugins/host-events.ts` defines typed command, workspace, Claude, plugin and file notification contracts. Host phases describe application boundaries, not every syscall: direct repository calls and trusted plugin Node code remain outside workspace phases. Started and terminal operation records share an invocation-local ID and carry scope provenance. Command start precedes plugin activation; plugins can explicitly replay the bounded history to observe earlier registration/start records, then subscribe to future records through `onAny`. Replay is an in-memory snapshot, not persistent storage or an atomic catch-up subscription. Host failure summaries contain codes and status; raw input, error messages and native output remain outside those summaries. Awaited observer failures become warnings and do not replace the original result or undo commits.

Installed Claude execution is an application service behind the `ClaudeRuntime` port. Built-in commands and ordinary namespaced Forge plugin commands share `ClaudeLifecycle`, exposed through the typed `context.claude` client. The composition root binds it to the same selected root, dry-run setting and event bus as the command; plugins supply native arguments and response parsing preferences without reconstructing CLI routing or importing infrastructure. Dry runs return redacted plans without constructing a process adapter. Real execution preserves native status and diagnostics, parses requested output even when Claude returns a nonzero status, and emits `claude.executed` only after receiving an exit status. Native process changes remain external operations rather than revision-guarded Workspace transactions.

## Declarative UI generation

`src/domain/ui/definition.ts` defines framework-neutral elements, scalar props, component references, child slots and Storybook metadata. `src/domain/ui/library.ts` owns graph invariants and reference selection; `src/domain/ui/syntax.ts` defines shared binding and element syntax. They reject duplicate IDs, missing references, cycles and invalid prop bindings before generation. `src/application/ui/library.ts` orchestrates library initialization, import/export and generation through injected codec/renderer ports. The Markdown codec and framework renderers live in infrastructure; composition stays in `src/main.ts`.

The shared library is workspace-scoped. Presentation translates selected-project output paths explicitly before passing plans to workspace orchestration. UI, stories and transferred Markdown use workspace collision checks, dry-run previews and post-commit events. UI regeneration accepts an explicit map of inspected destination revisions; import/export remains create-only. Definitions and their transitive references form a deterministic input graph: stable ordering and escaping produce repeatable bytes without timestamps or executing source content. Storybook extension modules remain ordinary target-project code and are imported by generated stories, never evaluated by the CLI.

The intermediate representation expresses elements, scalar props/state, bindings, composition and references to shared interaction definitions. `src/domain/ui/interactions.ts` owns framework-independent interaction values, state-use analysis and attachment validation against component state and element capabilities. Injected library ports supply definitions, and infrastructure renderers consume that analysis to emit executable handlers. Declared events/actions have a bounded portable contract; arbitrary framework state machines, asynchronous application workflows and framework-specific event systems remain application code. Framework-native extension modules let stories use executable Storybook APIs beyond JSON-compatible metadata. See [component contracts and limits](../reference/ui-components.md).

## Patterns adapted from obsidian-plugin-shell

The reference was inspected on 2026-10-07. This implementation adapts ideas rather than copying its runtime:

| Reference | Adaptation |
| --- | --- |
| [Plugin API](https://github.com/Luis85/obsidian-plugin-shell/blob/main/plugins/api.ts) | Explicit versioned manifest, command definitions, event descriptors and lifecycle context |
| [Plugin runtime](https://github.com/Luis85/obsidian-plugin-shell/blob/main/plugins/runtime.ts) | Atomic contribution validation, duplicate rejection, owned namespaces, `onload` and reverse `onunload` cleanup |
| [Event bus design](https://github.com/Luis85/obsidian-plugin-shell/blob/main/docs/architecture/EVENT-BUS.md) | Runtime payload checks, notification isolation, scoped subscriptions and events after committed changes |
| [Document generation](https://github.com/Luis85/obsidian-plugin-shell/blob/main/docs/development/GENERATOR-DECLARATIVE-ACTIONS.md) | Validated inputs, explicit plans and stale-write guards through a single storage owner |

The standalone environment changes several choices: shared `bin/plugins` directories use Obsidian-inspired manifests and ESM/CommonJS entry points without a core rebuild; Node implements storage; no GUI, host bridge, Vue or Obsidian API is needed; listener delivery is explicitly awaited and ordered for one CLI invocation. Established libraries own CLI grammar, configuration validation, Markdown parsing, YAML and date formatting. DDD is applied to meaningful invariants and vocabulary rather than introducing aggregate/repository layers with no behavior.

## Intentional limits

The event bus is ephemeral, not a durable queue or event-sourced store. There is no watch daemon or IPC in version 0.1. Plugin code is trusted Node code, not sandboxed. Each replaced file and changed directory entry is fsynced before a write reports success, and a multi-file write rolls back reported errors, but a batch cannot promise crash atomicity. An external editor does not honor the CLI lock, and Forge reports a stale lock without removing it. Scaffolds encode useful boundaries but cannot invent a project's business rules or prove its quality. Skills guide the agent to establish acceptance criteria and verify behavior after generation.
