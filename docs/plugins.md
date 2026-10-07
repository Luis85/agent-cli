# Plugins and events

Plugins extend the distributed bundle without rebuilding it. Use reviewed local `.mjs` (ESM default export) or `.cjs` (`module.exports`) files. TypeScript plugin source must first be compiled/bundled to one of these formats using the plugin author's toolchain. The host does not install dependencies or resolve a marketplace.

## Load explicitly

```sh
node bin/app make plugin Quality --out plugins
```

Create or edit `agent-cli.plugins.json`:

```json
{"apiVersion":1,"plugins":["plugins/quality.mjs"]}
```

```sh
node bin/app --plugins agent-cli.plugins.json schema --json
node bin/app --plugins agent-cli.plugins.json quality.hello
```

Paths in the manifest are relative to `--root`, not to the manifest file. No plugins load implicitly. Symlink modules are rejected. Modules execute with the Node process's permissions; only enable code you trust. A plugin can bypass the workspace adapter with direct Node calls, so the host cannot enforce dry-run or path containment for arbitrary plugin code.

## Contract

The shipped type-only SDK is `bin/app/types/sdk.d.ts`. In a TypeScript plugin project:

```ts
import type { Plugin } from '../bin/app/types/sdk.js';
const plugin = {
  manifest: { id: 'quality', version: '1.0.0', apiVersion: 1 },
  commands: [{
    id: 'quality.status',
    description: 'Report readiness',
    usage: 'quality.status',
    run() { return { ready: true }; },
  }],
} satisfies Plugin;
export default plugin;
```

All contributions must be namespaced with the manifest ID, such as `quality.status`, `quality.fixture`, `quality.checked`, and `quality.review`. Duplicate IDs fail startup. The manifest requires a lowercase kebab-case ID, a numeric `major.minor.patch` version, and `apiVersion:1`. Pre-release version strings and inter-plugin dependency ordering are not supported in this version.

- **Commands:** `id`, `description`, `usage`, optional `options:{flag:'string'|'boolean'}`, `run(args, flags, context)`. Global options are reserved. Return JSON-serializable data; do not write logs to stdout. Put diagnostic messages in `context.events.warn`.
- **Generators:** `id`, `description`, `generate(name, directory)`. Return `{path,bytes,expectedRevision?}[]`. The host validates document formats and destinations, previews or writes the plan, and emits committed file events. Use `new TextEncoder().encode(text)` for text bytes. A generator should be a pure function and must not perform its own writes during preview.
- **Skills:** `id`, `content` containing a Markdown SKILL.md with frontmatter. They appear in `skills list/show/install` and `init`.
- **Events:** `id`, `validate(payload)` runtime type guard. Register all definitions before activation. `context.events.on<T>(id, callback)` supports typed callbacks; callers remain responsible for the name/type pairing, and emit performs runtime validation.
- **Lifecycle:** optional `activate(context)` may return an async cleanup function. Activation follows manifest order; cleanup follows reverse order, including after command or activation failures. Cleanup errors become warnings. A failing plugin must clean up resources acquired within its own incomplete activation.

`context` supplies `root`, `workspace`, `events`, and a lazy `input()` reader. `workspace.read`, `workspace.edit`, and `workspace.write` apply validation, revisions, dry-run and events. `workspace.files` is the low-level injected repository; prefer the workspace methods for writes so document validation and notifications remain consistent. `workspace.dryRun` describes the invocation.

See [examples/quality.mjs](../examples/quality.mjs) for a runnable plugin with a command, generator, event listener and skill. The example manifest can be loaded from the repository with `--plugins examples/plugins.json`.

## Event delivery

Built-in `file.created` and `file.updated` payloads have `path`, SHA-256 `revision`, byte count `bytes`, and `operation` (`created` or `updated`). They are emitted only after the entire batch completes. Dry runs and failed writes emit no file events.

Each invocation owns one bus. Definitions validate before delivery. Listeners run in registration order and are awaited. Each listener receives a cloned snapshot so mutation cannot affect another listener or the recorded event. `on` returns an unsubscribe function; `once` unsubscribes before invoking the callback, including during reentrant emission. Removals during delivery take effect immediately. Listeners added during an emission join future emissions. Recursion is bounded to 32 active deliveries. Output records at most 1,000 events and 1,000 warnings; delivery itself is not truncated.

Synchronous throws and asynchronous rejections from listeners become warnings and delivery continues. Events are notifications, not approval hooks or transaction vetoes. A callback must settle; the host does not forcibly time out arbitrary Node plugin code. Dispose removes subscriptions and rejects later bus use. Event records are ephemeral and appear in the command result, not a durable replay log or filesystem watcher.
