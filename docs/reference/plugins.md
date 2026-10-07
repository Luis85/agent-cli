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
- **Lifecycle:** optional `onload(context)` runs in configured order; `onunload()` runs in reverse order after success or failure, including partial loading. The existing cleanup hook is captured before `onload` and retains its plugin receiver, so release partially acquired resources safely. Replacing `onunload` during activation does not replace the captured cleanup. Cleanup errors become warnings. Returning a function from `onload` is not a cleanup contract; implement `onunload` explicitly.

`context` supplies `workspaceRoot`, `root`, `project`, `workspace`, `events`, `claude`, and a lazy `input()` reader. `workspaceRoot` always identifies the environment; `project` is the active project metadata or null. For plugin commands, `root` and `workspace` refer to the active project, or the workspace when none is selected; plugin loading still uses shared workspace `bin/plugins`. `workspace.read`, `workspace.edit`, and `workspace.write` apply validation, revisions, dry-run and events. `workspace.files` is a low-level repository port; use workspace methods for writes so validation and notifications remain consistent. `workspace.dryRun` describes the invocation.

Help, schema, configuration, formats, events, plugin listing, Claude capability discovery and setup register contributions without calling `onload`. Their module imports still execute top-level code, so entry points must avoid top-level side effects. Other commands run the lifecycle; respect dry-run and avoid unrelated writes. `--no-plugins` skips plugin loading entirely.

The [quality example](../../examples/plugins/quality/main.mjs) includes a command, generator, event listener and skill. Copy its `quality` directory to workspace `bin/plugins/quality`, review it, and enable `quality` in `bin/config.json`. Then run `node bin/app.js quality.check`. The distribution also includes the example under `bin/data/examples/plugins/quality`.

## Reuse Claude lifecycle execution

Ordinary namespaced plugin commands can use `context.claude.execute(request)` to invoke the installed Claude CLI through the same host-owned lifecycle service as built-in commands. Plugins do not need imports from Forge internals or a new contribution type:

```ts
import type { Plugin } from '../bin/data/types/sdk.js';
export default {
  commands: [{
    id: 'quality.claude-plugins',
    description: 'Inspect installed Claude plugins',
    usage: 'quality.claude-plugins',
    run(_args, _flags, context) {
      return context.claude.execute({
        args: ['plugin', 'list', '--json'],
        output: 'json',
      });
    },
  }],
} satisfies Omit<Plugin, 'manifest'>;
```

The type-only SDK exports `ClaudeLifecycleClient`, `ClaudeLifecycleRequest`, `ClaudeLifecyclePlan`, `ClaudeLifecycleResult` and `ClaudeOutput`. Requests contain literal `args` and optional `executable`, `timeoutMs`, UTF-8 `stdin`, `output` and `sensitiveArgs` indices. `output` is `text` by default, `json` for an entire JSON response, or `json-last-line` for commands whose final stdout line is native JSON. The host fixes the working directory to the invocation's selected root and applies its dry-run setting. A plugin cannot override either through this service.

Dry runs validate the request and return `{dryRun:true, executed:false, plan}` without creating a runtime process. Real execution passes arguments directly without a shell, closes stdin after optional input, and applies timeout/output bounds. `stdin` contents are omitted from plans; plans record `inputBytes`. `--config` values and indices listed in `sensitiveArgs` are redacted in the plan. Native stdout/stderr remain available for diagnostics and may contain values echoed by Claude itself.

Successful execution returns the plan fields plus `dryRun:false`, `executed:true`, `exitCode`, `stdout`, `stderr`, and parsed `result` when requested. A nonzero native exit remains `CLAUDE_RUNTIME_FAILED`; its error details preserve exit status, diagnostic streams and parseable native JSON. Inspect that result before retrying an operation that may already have changed external state. Invalid requested JSON after a successful exit yields `CLAUDE_INVALID_OUTPUT`. An already-achieved state reported by Claude is not silently reclassified as success.

The host emits `claude.executed` after receiving a process exit status, including nonzero status, with `{executable,cwd,exitCode}`. Dry runs and process failures without an exit status emit no such event. Listener failures remain warnings and cannot erase the native result. This service runs already-authorized operations chosen by a trusted plugin; it does not install Claude, trust a plugin automatically, or change the existing explicit Forge plugin-enablement rules.

## Event delivery

Built-in `file.created`, `file.updated`, and `file.deleted` payloads contain `path`, SHA-256 `revision`, byte count `bytes`, and `operation` (`created`, `updated`, or `deleted`). For deletion, revision and bytes identify the removed content. Paths are relative to the command root reported in the response context: the environment for project management, or the selected project for file commands. Claude user-scope commands report their configuration root separately in `data.target.directory`. Events follow successful persistence; batch write events wait until the entire batch completes. Dry runs and failed writes emit no file events.

Each invocation owns one bus. Payloads must be finite JSON data: primitives, arrays and plain objects; undefined, BigInt, nonfinite numbers, Dates, Maps and cycles are rejected. Definitions validate isolated snapshots before delivery, so a validator cannot mutate the recorded payload. Listeners run in registration order and are awaited. Each receives a cloned snapshot so mutation cannot affect other listeners or event history.

`on` returns an unsubscribe function; `once` unsubscribes before invoking its callback, including during reentrant emission. Removals during delivery take effect immediately. Listeners added during an emission join future emissions. Recursion is bounded to 32 active ancestors in the same asynchronous delivery chain, including across `await`. Independent concurrent emissions and parallel sibling emissions do not consume one another's recursion budget. Completed ancestors do not count against notifications scheduled for a later turn. Output records at most 1,000 events and 1,000 warnings; delivery itself is not truncated.

Synchronous throws and asynchronous listener rejections become warnings and delivery continues. Events notify about changes; they cannot veto transactions. Callbacks must settle; arbitrary Node plugin code has no forced timeout. Dispose removes subscriptions and rejects later bus use. Records appear in the command result and are not a durable replay log or filesystem watcher.
