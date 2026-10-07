# Architecture

[Documentation](../index.md) · Explanation

## Boundaries

The domain uses the terms **workspace**, **file snapshot**, **revision**, **write plan**, **generator**, and **committed change**. The filesystem is an adapter; Obsidian is not a runtime dependency. A workspace owns fixed `bin` resources and a configurable managed-project directory. Persistent project selection chooses the root for document commands and generators; shared templates/plugins and project management remain workspace-scoped. Command responses identify the executed scope. Revisions describe file content, not elapsed time or a globally ordered version.

- `src/domain`: path rules, file kinds, value contracts, Canvas invariants, and application errors. No Node imports or infrastructure dependencies.
- `src/application`: injected repository/codec ports, write orchestration, invocation event bus, plugin contracts and registry. No Node imports.
- `src/infrastructure`: Node repository, Zod configuration adapter, unified/remark Markdown parser, YAML/document codecs, Day.js template rendering, runtime module loader, generator implementations, embedded skills.
- `src/presentation`: argument parsing, discoverable command definitions, input/output translation.
- `src/main.ts`: composition root. It creates services, registers capabilities, loads explicitly enabled plugins, runs a command, cleans up and serializes the result.

The architecture test recursively inspects TypeScript syntax to enforce inward imports for domain and application, including side-effect imports, re-exports and dynamic imports. The design uses small explicit constructors and ports rather than a global service locator. The workspace use case owns validation and post-commit notifications; command handlers do not publish fake file events. Plugin generators return write plans instead of writing directly. Core event delivery failures become warnings because persistence has already succeeded.

## Declarative UI generation

`src/domain/ui.ts` defines framework-neutral elements, scalar props, component references, child slots and Storybook metadata. `src/domain/ui-library.ts` owns graph invariants and reference selection; `src/domain/ui-syntax.ts` defines shared binding and element syntax. They reject duplicate IDs, missing references, cycles and invalid prop bindings before generation. `src/application/ui.ts` orchestrates library initialization, import/export and generation through injected codec/renderer ports. The Markdown codec and framework renderers live in infrastructure; composition stays in `src/main.ts`.

The shared library is workspace-scoped. Presentation translates selected-project output paths explicitly before passing plans to workspace orchestration. UI, stories and transferred Markdown use workspace collision checks, dry-run previews and post-commit events. UI regeneration accepts an explicit map of inspected destination revisions; import/export remains create-only. Definitions and their transitive references form a deterministic input graph: stable ordering and escaping produce repeatable bytes without timestamps or executing source content. Storybook extension modules remain ordinary target-project code and are imported by generated stories, never evaluated by the CLI.

The intermediate representation deliberately expresses elements, scalar bindings and composition. It does not translate arbitrary application state or framework event systems. Framework-native extension modules let stories use executable Storybook APIs beyond JSON-compatible metadata. See [component contracts and limits](../reference/ui-components.md).

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

The event bus is ephemeral, not a durable queue or event-sourced store. There is no watch daemon or IPC in version 0.1. Plugin code is trusted Node code, not sandboxed. A multi-file write rolls back reported errors but cannot promise crash atomicity. An external editor does not honor the CLI lock. Scaffolds encode useful boundaries but cannot invent a project's business rules or prove its quality. Skills guide the agent to establish acceptance criteria and verify behavior after generation.
