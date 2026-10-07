# Plugins and events

[Documentation](../index.md) · Reference

Plugins extend the distributed bundle without rebuilding it. Each enabled plugin has its own directory, a `manifest.json`, and a `main.mjs` ESM entry point or `main.js` CommonJS entry point. The host uses Obsidian-inspired packaging and lifecycle conventions; it does not provide Obsidian's runtime API or run existing Obsidian plugins unchanged. Plugin authors compile TypeScript and bundle external dependencies before distribution.

For installation steps, see [enable a plugin](../how-to/enable-plugins.md).

## Manifest

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

The shipped type-only SDK is `bin/data/types/sdk.d.ts`. The module exports an object or a class instantiated with its manifest; the loader supplies the manifest to the resulting instance. A TypeScript module can declare contributions as follows:

```ts
import type { Plugin } from '../bin/data/types/sdk.js';
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

`context` supplies `workspaceRoot`, `root`, `project`, `workspace`, `events`, and a lazy `input()` reader. `workspaceRoot` always identifies the environment; `project` is the active project metadata or null. For plugin commands, `root` and `workspace` refer to the active project, or the workspace when none is selected; plugin loading still uses shared workspace `bin/plugins`. `workspace.read`, `workspace.edit`, and `workspace.write` apply validation, revisions, dry-run and events. `workspace.files` is a low-level repository port; use workspace methods for writes so validation and notifications remain consistent. `workspace.dryRun` describes the invocation.

Help, schema, configuration, formats, events, plugin listing and setup register contributions without calling `onload`. Their module imports still execute top-level code, so entry points must avoid top-level side effects. Other commands run the lifecycle; respect dry-run and avoid unrelated writes. `--no-plugins` skips plugin loading entirely.

The [quality example](../../examples/plugins/quality/main.mjs) includes a command, generator, event listener and skill. Copy its `quality` directory to workspace `bin/plugins/quality`, review it, and enable `quality` in `bin/config.json`. Then run `node bin/app.js quality.check`. The distribution also includes the example under `bin/data/examples/plugins/quality`.

## Event delivery

Built-in `file.created`, `file.updated`, and `file.deleted` payloads contain `path`, SHA-256 `revision`, byte count `bytes`, and `operation` (`created`, `updated`, or `deleted`). For deletion, revision and bytes identify the removed content. Paths are relative to the command root reported in the response context: the environment for project management, or the selected project for file commands. Claude user-scope commands report their configuration root separately in `data.target.directory`. Events follow successful persistence; batch write events wait until the entire batch completes. Dry runs and failed writes emit no file events.

Each invocation owns one bus. Payloads must be finite JSON data: primitives, arrays and plain objects; undefined, BigInt, nonfinite numbers, Dates, Maps and cycles are rejected. Definitions validate isolated snapshots before delivery, so a validator cannot mutate the recorded payload. Listeners run in registration order and are awaited. Each receives a cloned snapshot so mutation cannot affect other listeners or event history.

`on` returns an unsubscribe function; `once` unsubscribes before invoking its callback, including during reentrant emission. Removals during delivery take effect immediately. Listeners added during an emission join future emissions. Recursion is bounded to 32 active deliveries. Output records at most 1,000 events and 1,000 warnings; delivery itself is not truncated.

Synchronous throws and asynchronous listener rejections become warnings and delivery continues. Events notify about changes; they cannot veto transactions. Callbacks must settle; arbitrary Node plugin code has no forced timeout. Dispose removes subscriptions and rejects later bus use. Records appear in the command result and are not a durable replay log or filesystem watcher.
