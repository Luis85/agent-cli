# Architecture

## Boundaries

The domain uses the terms **workspace**, **file snapshot**, **revision**, **write plan**, **generator**, and **committed change**. The filesystem is an adapter; Obsidian is not a runtime dependency. Revisions describe file content, not elapsed time or a globally ordered version.

- `src/domain`: path rules, file kinds, value contracts, Canvas invariants, and application errors. No Node imports or infrastructure dependencies.
- `src/application`: injected repository/codec ports, write orchestration, invocation event bus, plugin contracts and registry. No Node imports.
- `src/infrastructure`: Node repository, Zod configuration adapter, unified/remark Markdown parser, YAML/document codecs, Day.js template rendering, runtime module loader, generator implementations, embedded skills.
- `src/presentation`: argument parsing, discoverable command definitions, input/output translation.
- `src/main.ts`: composition root. It creates services, registers capabilities, loads explicitly enabled plugins, runs a command, cleans up and serializes the result.

The architecture test enforces inward imports for domain and application. The design uses small explicit constructors and ports rather than a global service locator. The workspace use case owns validation and post-commit notifications; command handlers do not publish fake file events. Plugin generators return write plans instead of writing directly. Core event delivery failures become warnings because persistence has already succeeded.

## Patterns adapted from obsidian-plugin-shell

The reference was inspected on 2026-10-07. This implementation adapts ideas rather than copying its runtime:

| Reference | Adaptation |
| --- | --- |
| [Plugin API](https://github.com/Luis85/obsidian-plugin-shell/blob/main/plugins/api.ts) | Explicit versioned manifest, command definitions, event descriptors and lifecycle context |
| [Plugin runtime](https://github.com/Luis85/obsidian-plugin-shell/blob/main/plugins/runtime.ts) | Atomic contribution validation, duplicate rejection, owned namespaces, `onload` and reverse `onunload` cleanup |
| [Event bus design](https://github.com/Luis85/obsidian-plugin-shell/blob/main/docs/architecture/EVENT-BUS.md) | Runtime payload checks, notification isolation, scoped subscriptions and events after committed changes |
| [Document generation](https://github.com/Luis85/obsidian-plugin-shell/blob/main/docs/development/GENERATOR-DECLARATIVE-ACTIONS.md) | Validated inputs, explicit plans and stale-write guards through a single storage owner |

The standalone environment changes several choices: configured plugin directories use Obsidian-inspired manifests and ESM/CommonJS entry points without a core rebuild; Node implements storage; no GUI, host bridge, Vue or Obsidian API is needed; listener delivery is explicitly awaited and ordered for one CLI invocation. Established libraries own CLI grammar, configuration validation, Markdown parsing, YAML and date formatting. DDD is applied to meaningful invariants and vocabulary rather than introducing aggregate/repository layers with no behavior.

## Intentional limits

The event bus is ephemeral, not a durable queue or event-sourced store. There is no watch daemon or IPC in version 0.1. Plugin code is trusted Node code, not sandboxed. A multi-file write rolls back reported errors but cannot promise crash atomicity. An external editor does not honor the CLI lock. Scaffolds encode useful boundaries but cannot invent a project's business rules or prove its quality. Skills guide the agent to establish acceptance criteria and verify behavior after generation.
