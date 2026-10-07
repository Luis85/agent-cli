# Plugins and events

Plugins extend the distributed bundle without rebuilding it. Each enabled plugin has its own directory, a `manifest.json`, and a `main.mjs` ESM entry point or `main.js` CommonJS entry point. The host uses Obsidian-inspired packaging and lifecycle conventions; it does not provide Obsidian's runtime API or run existing Obsidian plugins unchanged. Plugin authors compile TypeScript and bundle external dependencies before distribution.

## Install and enable

```sh
node bin/app make plugin Quality
```

The generator creates `quality/manifest.json` and `quality/main.mjs` under the configured plugin directory, default `.agent-cli/plugins`. Review the code, then add the directory ID to `bin/config.json`:

```json
{
  "schemaVersion": 1,
  "paths": { "root": "..", "plugins": ".agent-cli/plugins" },
  "plugins": { "enabled": ["quality"] }
}
```

```sh
node bin/app plugins --json
node bin/app quality.hello
```

Only IDs in `plugins.enabled` execute; directory scanning never enables unreviewed code. Put `--no-plugins` before the command to skip them for one invocation, including when an enabled plugin fails to load. IDs must match their directory and manifest. Plugin paths resolve against the selected project root. Symlink modules are rejected. Plugins are trusted Node code with the process's permissions and can bypass workspace guards; review modules and dependencies before enabling them.

A manifest contains:

```json
{
  "id": "quality",
  "name": "Quality checks",
  "version": "1.0.0",
  "minAppVersion": "0.1.0",
  "description": "Engineering checks and generators",
  "author": "Your team"
}
```

All fields are required. IDs use lowercase kebab-case; versions use numeric `major.minor.patch` without prerelease identifiers or leading zeros. The host rejects unsupported `minAppVersion` before executing plugins. Every enabled manifest is validated before the first entry point is loaded. `main.mjs` takes precedence; `main.js` uses CommonJS even inside an ESM project.

## Contract

The shipped type-only SDK is `bin/app/types/sdk.d.ts`. The module exports an object or a class instantiated with its manifest; the loader supplies the manifest to the resulting instance. A TypeScript module can declare contributions as follows:

```ts
import type { Plugin } from '../bin/app/types/sdk.js';
const plugin = {
  commands: [{
    id: 'quality.status',
    description: 'Report readiness',
    usage: 'quality.status',
    run() { return { ready: true }; },
  }],
} satisfies Omit<Plugin, 'manifest'>;
export default plugin;
```

Contributions must be namespaced with the manifest ID, such as `quality.status`, `quality.fixture`, `quality.checked`, and `quality.review`. Invalid contributions or duplicate IDs reject the complete plugin registration, leaving no partially registered capabilities. All contributions register before lifecycle activation.

- **Commands:** `id`, `description`, `usage`, optional `options:{flag:'string'|'boolean'}`, `run(args, flags, context)`. Global options are reserved. Return JSON-serializable data; never log to stdout. Send diagnostic messages to `context.events.warn`.
- **Generators:** `id`, `description`, `generate(name, directory)`. Return `{path,bytes,expectedRevision?}[]`. The host validates documents and destinations, previews or writes the plan, and emits committed file events. Encode text with `new TextEncoder().encode(text)`. Generators should be pure and perform no direct writes.
- **Skills:** `id`, `content` containing a Markdown SKILL.md with frontmatter. They appear in `skills list/show/install` and `setup`.
- **Events:** `id`, `validate(payload)` synchronous runtime type guard returning a boolean. `context.events.on<T>(id, callback)` supports typed callbacks; callers remain responsible for the name/type pairing, and emit validates data at runtime.
- **Lifecycle:** optional `onload(context)` runs in configured order; `onunload()` runs in reverse order after success or failure, including partial loading. Cleanup is registered before `onload`, so release partially acquired resources safely. Cleanup errors become warnings. Returning a function from `onload` is not a cleanup contract; implement `onunload` explicitly.

`context` supplies `root`, `workspace`, `events`, and a lazy `input()` reader. `workspace.read`, `workspace.edit`, and `workspace.write` apply validation, revisions, dry-run and events. `workspace.files` is a low-level repository port; use workspace methods for writes so validation and notifications remain consistent. `workspace.dryRun` describes the invocation.

Help, schema, configuration, formats, events, plugin listing and setup register contributions without calling `onload`. Their module imports still execute top-level code, so entry points must avoid top-level side effects. Other commands run the lifecycle; respect dry-run and avoid unrelated writes. `--no-plugins` skips plugin loading entirely.

The [quality example](../examples/plugins/quality/main.mjs) includes a command, generator, event listener and skill. From a source checkout, run `node bin/app --config examples/config.json quality.check`. The bundle also includes `examples/config.json`; run `node bin/app --config bin/app/examples/config.json quality.check` to inspect bundled example content. For your own project, copy the `quality` directory into its configured plugin directory and enable its ID.

## Event delivery

Built-in `file.created` and `file.updated` payloads contain `path`, SHA-256 `revision`, byte count `bytes`, and `operation` (`created` or `updated`). They are emitted only after the entire batch completes. Dry runs and failed writes emit no file events.

Each invocation owns one bus. Payloads must be finite JSON data: primitives, arrays and plain objects; undefined, BigInt, nonfinite numbers, Dates, Maps and cycles are rejected. Definitions validate isolated snapshots before delivery, so a validator cannot mutate the recorded payload. Listeners run in registration order and are awaited. Each receives a cloned snapshot so mutation cannot affect other listeners or event history.

`on` returns an unsubscribe function; `once` unsubscribes before invoking its callback, including during reentrant emission. Removals during delivery take effect immediately. Listeners added during an emission join future emissions. Recursion is bounded to 32 active deliveries. Output records at most 1,000 events and 1,000 warnings; delivery itself is not truncated.

Synchronous throws and asynchronous listener rejections become warnings and delivery continues. Events notify about changes; they cannot veto transactions. Callbacks must settle; arbitrary Node plugin code has no forced timeout. Dispose removes subscriptions and rejects later bus use. Records appear in the command result and are not a durable replay log or filesystem watcher.
