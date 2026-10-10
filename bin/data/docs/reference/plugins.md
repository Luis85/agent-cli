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

All fields are required. IDs use lowercase kebab-case and cannot be a host event namespace (`command`, `operation`, `claude`, `vault`, `workspace`, `plugin`), which fails with `PLUGIN_NAMESPACE`; versions use numeric `major.minor.patch` without prerelease identifiers or leading zeros. The host rejects unsupported `minAppVersion` before executing plugins. Every enabled manifest is validated before the first entry point is loaded. `main.mjs` takes precedence; `main.js` uses CommonJS even inside an ESM project.

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
- **Generators:** `id`, `description`, `generate(name, directory)`. Return `{path,bytes,expectedRevision?}[]`. The host validates documents and destinations, previews or writes the plan, and emits committed `vault.*` events. Encode text with `new TextEncoder().encode(text)`. Generators should be pure and perform no direct writes.
- **Skills:** `id`, `content` containing a Markdown SKILL.md with frontmatter. They appear in `skills list/show/install` and `setup`.
- **Events:** `id`, optional nonempty `description`, and `validate(payload)` synchronous runtime type guard returning a boolean. Segments start with a lowercase letter and may use camelCase or kebab-case. `context.events.on<T>(id, callback)` supports typed callbacks; callers remain responsible for the name/type pairing, and emit validates data at runtime. Descriptions appear in event discovery. A plugin may emit only events in its own `<plugin-id>.*` namespace; see [event ownership](#event-ownership).
- **Lifecycle:** optional `onload(context)` runs in configured order; `onunload()` runs in reverse order after success or failure, including partial loading. Optional `onUserEnable(context)` and `onExternalSettingsChange(context)` run right after `onload`; see [lifecycle hooks](#lifecycle-hooks-layout-ready-and-quit). The existing cleanup hook is captured before `onload` and retains its plugin receiver, so release partially acquired resources safely. Replacing `onunload` during activation does not replace the captured cleanup. Cleanup errors become warnings. Returning a function from `onload` is not a cleanup contract; implement `onunload` explicitly.

`context` supplies `workspaceRoot`, `root`, `project`, `workspace`, `events`, `claude`, `metadata`, `app` and a lazy `input()` reader. `app` is the Obsidian-shaped [facade](#the-app-facade) over the same scope; prefer it. `metadata` is the invocation's lazily built [metadata index](../explanation/architecture.md#kernel-metadata-cache) for the same root as `workspace`, which `app.metadataCache` wraps. A plugin's `onload`, activation hooks and commands receive `events` as that plugin's `EventChannel` (exported by the SDK): it observes every event and exposes `ids`, `catalog`, `on`, `once`, `onAny`, `replay`, `emit`, `warn`, `onLayoutReady` and `onQuit`. `workspaceRoot` always identifies the environment; `project` is the active project metadata or null. For plugin commands, `root` and `workspace` refer to the active project, or the workspace when none is selected; plugin loading still uses shared workspace `bin/plugins`. `workspace.read`, `workspace.edit`, `workspace.write`, `workspace.remove` and `workspace.commit` (a batch of renames, writes and removals) apply their validation, revision, dry-run and event contracts. In a dry run, `workspace.edit` returns each change with a unified `diff`; pass `workspace.write(writes, { diff: true })` for the same preview on writes (`diff: null` for binary content). The SDK types these as `WriteOptions` and `PlannedChange` (a `FileChange` with `diff`). `workspace.read` and `workspace.codec.inspect` return the complete Markdown document including `body`; only the CLI `read` response omits it unless `--parts body` is given. `workspace.files` is a low-level repository port; its direct reads/listings produce neither `operation.*` phases nor `workspace.file-open`. Use workspace methods for writes so validation and notifications remain consistent. `workspace.dryRun` describes the invocation.

Help, schema, configuration, formats, events, plugin listing, Claude capability discovery and setup register contributions without calling `onload`. Their module imports still execute top-level code, so entry points must avoid top-level side effects. Other commands run the lifecycle; respect dry-run and avoid unrelated writes. `--no-plugins` skips plugin loading entirely.

The [quality example](../examples/plugins/quality/main.mjs) includes commands, a generator, event listeners and a skill, and uses the [app facade](#the-app-facade): `app.vault.on('rename')` warns about moved notes and `quality.mark-reviewed <note.md>` edits frontmatter with `app.fileManager.processFrontMatter`. Copy its `quality` directory to workspace `bin/plugins/quality`, review it, and enable `quality` in `bin/config.json`. Then run `node bin/forge.js quality.check`. The distribution also includes the example under `bin/data/docs/examples/plugins/quality`.

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

The host emits `claude.started` before service validation, followed by `claude.succeeded` or `claude.failed` for validation, previews, process execution and output parsing. The existing `claude.executed` event remains: it follows a process exit status, including nonzero status, with `{executable,cwd,exitCode}`. Dry runs and process failures without an exit status emit no `claude.executed`. A successful process can still produce `claude.failed` when requested JSON is malformed. These events omit arguments, stdin and native output; inspect the command result for detailed diagnostics. Listener failures remain warnings and cannot erase the native result. This service runs already-authorized operations chosen by a trusted plugin; it does not install Claude, trust a plugin automatically, or change the existing explicit Forge plugin-enablement rules.

## Host events and correlation

Run `node bin/forge.js events --json` to discover event IDs in `data.events`, descriptions in `data.contracts`, and delivery semantics in `data.delivery`. `context.events.catalog()` exposes `{id, description?}` entries. The type-only SDK exports `HostEventMap`, `HostEventId` and the discriminated `HostEventRecord` union in addition to the open `EventRecord` used for plugin-defined events.

| Event family | Observation boundary and payload |
| --- | --- |
| `command.started`, `command.succeeded`, `command.failed` | Routed command lifecycle, including plugin activation and command-result serialization; `operationId`, command ID, `root`, `workspaceRoot`, `dryRun` |
| `operation.started`, `operation.succeeded`, `operation.failed` | Guarded workspace `read`, `write`, `edit`, `remove`, `move` or `delete`; `operationId`, `operation`, `root`, relative `paths`, `dryRun`; success can include bytes, change summaries and `renames` (`{from, to, kind}`) |
| `vault.create`, `vault.modify`, `vault.delete` | Obsidian's vault events after a committed write: `{path, kind, operation, revision?, bytes?}`. Files (`kind: "file"`) carry SHA-256 `revision` and `bytes` (prior content for a delete); folders (`kind: "folder"`) carry neither. `vault.modify` is file-only |
| `vault.rename` | `{path, oldPath, kind, revision?}` after a committed move: `path` is the new path. A moved folder publishes one record for itself, then one per moved descendant folder and file in path order; files carry their unchanged `revision`. `vault.rename` never updates links itself; the `move` batch publishes `vault.modify` for each rewritten file after the renames |
| `metadataCache.changed`, `metadataCache.deleted`, `metadataCache.resolve`, `metadataCache.resolved` | Obsidian's MetadataCache events, emitted after a committed batch's `vault.*` records once `context.metadata` was loaded in the invocation: `{path, cache}` per re-indexed Markdown or Canvas file with metadata, `{path, prevCache}` per file that left the index (`prevCache` is `null` for files without metadata), `{path}` per source whose link resolution was recomputed, then one `{}` per batch. `cache` is the JSON form of Obsidian's `CachedMetadata` shape. Paths are relative to `context.root`; see [metadata events](#metadata-events) |
| `workspace.file-open` | `{path}` after each successful `workspace.read`: the `read` command and plugin calls to `context.workspace.read` |
| `workspace.quick-preview` | `{path, operation, bytes}` for each planned file of a dry-run write, edit or removal; no content or diff |
| `workspace.layout-ready` | `{}` after every plugin activated and queued `onLayoutReady` callbacks ran, before the command runs |
| `workspace.quit` | `{}` at invocation end, after the command result, before quit tasks and plugin unloading; also after failures |
| `workspace.project-change` | `{from, to}` project names (or `null`) after `project open` or `project close` committed a different selection |
| `claude.started`, `claude.succeeded`, `claude.failed` | Claude application service invocation; `operationId`, executable, `cwd`, `dryRun`; terminal events include native `exitCode` when received |
| `claude.executed` | Native process returned an exit status; executable, `cwd`, native `exitCode` |
| `plugin.registered` | Atomic contribution registration was published; `pluginId` |
| `plugin.activating`, `plugin.activated`, `plugin.activation-failed` | Activation hook boundaries; `pluginId` |
| `plugin.unloading`, `plugin.unloaded`, `plugin.unload-failed` | Cleanup boundaries in reverse activation order; `pluginId` |

Failed phase payloads add `error: {code, exitCode}`. These summaries omit raw error messages and inputs; they do not replace the original error in the command response. Claude's optional top-level `exitCode` is its native process status, while `error.exitCode` is the host error status. Host metadata still contains paths, roots, command/plugin IDs and executable names; it is not a content-free audit record.

Each command, operation and Claude invocation obtains a positive integer from `events.nextOperationId()`. Its started and terminal records share that ID. IDs are invocation-local correlation values, not persistent identifiers or parent-child links. An edit calls a guarded write, so it produces distinct edit and write IDs; a failed write can be followed by a failed enclosing edit. Use operation IDs together with scope metadata instead of assuming one phase pair per CLI command. A workspace constructed without root provenance reports `root: null`.

`command.started` is recorded before plugin activation. Plugin listeners installed in `onload` can explicitly replay that record and earlier registration events. The host publishes registrations after loading contributions and before routing; registry activation also publishes any registrations not previously published. Discovery commands register plugins but do not activate their listeners, so they also emit no `workspace.layout-ready`. Bootstrap, module-loading and other failures before command routing cannot notify listeners that have not been installed.

The CLI response carries only committed `vault.*` records by default; run a command with `--events all` (or set `settings.events`) to see the full history in the envelope. Plugin listeners and `replay` always receive every event regardless of that level. The command envelope covers the routed CLI operation. Operation phases cover workspace methods, not every filesystem call: direct repository access, arbitrary plugin Node code and native subprocess activity are outside those method boundaries. Dry runs produce phase notifications, planned change summaries and `workspace.quick-preview` records but no `vault.*` or `metadataCache.*` events. `metadataCache.*` records are not change records: they appear in the envelope only with `--events all`.

### Metadata events

Like Obsidian's MetadataCache, the kernel index publishes its events after the vault events of the same commit. For each committed batch, in order: the batch's `vault.*` records; `metadataCache.changed` for each re-indexed Markdown or Canvas file that parsed (an unparseable file has no cache and no record); `metadataCache.deleted` for each file that left the index; `metadataCache.resolve` for each source whose `resolvedLinks`/`unresolvedLinks` entry was recomputed with a different result or new references; then one `metadataCache.resolved`. Each group is in vault path order. A write never builds the index, so metadataCache events are emitted for commits once the cache is loaded in the invocation; commands that need link integrity (delete and move, links, Bases) load it, and a plugin loads it with `await context.metadata.load()`. Before that load, commits publish no metadataCache records, and the first load reads the current files. The index and its paths belong to the command root: when a project is selected, workspace-scope commits inside the project directory are re-indexed with project-relative paths and commits outside it are not indexed. Claude user-scope writes never reach the index.

## The app facade

`context.app` mirrors Obsidian's `App` for the command's scope, so logic written against Obsidian's API ports with few changes. Paths replace `TFile` objects. Every mutation is a guarded workspace write: it honours the invocation's dry run, accepts an optional `{ifMatch}` revision guard (without it, the revision read just before the write guards it), and publishes the same `vault.*` and `metadataCache.*` records as the CLI. The SDK exports the facade types `App`, `VaultFacade`, `MetadataCacheFacade`, `WorkspaceFacade`, `FileManager`, `MoveOptions`, `DeleteOptions`, `Guard` and `BrokenLink`.

| Member | Behaviour |
| --- | --- |
| `app.vault.read(path)` | UTF-8 text of a file; no `workspace.file-open` record |
| `app.vault.create(path, data)` / `modify(path, data, {ifMatch?})` | Create a new file (an existing one is a `CONFLICT`) or replace one; return the `FileChange` |
| `app.vault.process(path, fn, {ifMatch?})` | Atomic read-modify-write of UTF-8 text; `fn(text)` returns the new text, which `process` returns |
| `app.vault.append(path, data, {ifMatch?})` | Append UTF-8 text |
| `app.vault.rename(path, newPath, {ifMatch?})` | Move without link updates, like Obsidian's `Vault.rename` |
| `app.vault.trash(path, {ifMatch?})` / `delete(path, {ifMatch?})` | Move to `.trash` or remove permanently (folders recursively) without checking links, like Obsidian's `Vault.trash`/`delete` |
| `app.vault.getMarkdownFiles()` / `getFiles()` | Visible paths in path order, as indexed by the metadata cache (dot-prefixed files and folders are omitted) |
| `app.vault.on('create' \| 'modify' \| 'delete' \| 'rename', callback)` | Subscribes to `vault.*`; the callback receives the record payload with `path` (and `oldPath` for renames). Returns an unsubscribe function |
| `app.metadataCache.getFileCache(path)` | A copy of the file's `CachedMetadata`, or `null` |
| `app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)` / `fileToLinktext(path, sourcePath, omitMdExtension?)` | Link resolution and shortest link text |
| `app.metadataCache.resolvedLinks()` / `unresolvedLinks()` | Copies of the link maps |
| `app.metadataCache.on('changed' \| 'deleted' \| 'resolve' \| 'resolved', callback)` | Subscribes to `metadataCache.*` |
| `app.fileManager.renameFile(path, newPath, {ifMatch?})` | Move with link updates, exactly like the `move` command; returns its result |
| `app.fileManager.trashFile(path, {ifMatch?, allowBrokenLinks?})` | Move a file or folder to `.trash`; refuses with `HAS_BACKLINKS` while other files link into it, like the `delete` command |
| `app.fileManager.processFrontMatter(path, fn, {ifMatch?})` | `fn` mutates a copy of the properties; changed keys are set and deleted keys removed in one guarded edit that preserves the body |
| `app.fileManager.move` / `rename` / `delete` | The full `move`, `rename` and `delete` command operations with their options |
| `app.workspace.onLayoutReady(callback)` | Same as `context.events.onLayoutReady` |
| `app.workspace.on('file-open' \| 'quick-preview' \| 'quit' \| 'project-change', callback)` | Subscribes to `workspace.*` |
| `app.workspace.getActiveProject()` | The project the command runs in, or `null` at workspace scope |

Differences from Obsidian: the metadata cache is built lazily per invocation, so `metadataCache` accessors return promises and the link maps are methods; `vault` listing methods are asynchronous for the same reason. Subscriptions last for the invocation. Calls the facade makes inside a listener are ordinary guarded writes and publish their own records.

```ts
import type { Plugin } from '../bin/data/types/sdk.js';
export default {
  onload({ app, events }) {
    app.vault.on('rename', ({ path, oldPath }) => events.warn(`Moved ${oldPath} to ${path}`));
  },
  commands: [{
    id: 'quality.mark-reviewed',
    description: 'Mark a note as reviewed',
    usage: 'quality.mark-reviewed <note.md>',
    async run([path], _flags, { app }) {
      return app.fileManager.processFrontMatter(path!, frontmatter => { frontmatter.reviewed = true; });
    },
  }],
} satisfies Omit<Plugin, 'manifest'>;
```

## Event ownership

Host namespaces (`vault`, `metadataCache`, `workspace`, `operation`, `command`, `plugin`, `claude`) are host-owned; `events --json` lists them in `data.hostNamespaces`. A plugin's channel may observe any event, but `context.events.emit(id, payload)` accepts only ids starting with `<plugin-id>.`. Emitting a host event or another plugin's event rejects with `EVENT_OWNERSHIP` before validation, delivery or history; an unknown id in the plugin's own namespace remains `UNKNOWN_EVENT`. Plugin ids cannot be host namespaces. Host-built commands receive the invocation bus itself. Plugins are trusted code, not a sandbox: ownership protects the event contract, not the process.

## Lifecycle hooks, layout ready and quit

Activation runs, per plugin in configured order: `plugin.activating`, `onload(context)`, then at most one activation hook, then `plugin.activated`.

- `onUserEnable(context)` runs once, on the first activation after the plugin id was added to `plugins.enabled`. Use it for one-time setup.
- `onExternalSettingsChange(context)` runs on a later activation when the plugin's settings revision differs from the one recorded at its previous activation. Plugin settings arrive with plugin config sections; until then a plugin has no settings source, so this hook is defined and validated but not yet triggered by the CLI.

Both hooks must return nothing; a throw is an activation failure. The host records the state of plugins that implement either hook in workspace data `bin/data/plugins-state.json` (`{schemaVersion: 1, plugins: {<id>: {settings}}}`) after activation, through a guarded workspace write whose `vault.*` records appear in the response, relative to the workspace root. A dry run calls the hooks but persists nothing, so the real run calls `onUserEnable` again. Entries for disabled plugins are dropped when the state is next written, so enabling a plugin again triggers `onUserEnable` again; a disable and re-enable between two activating invocations is not observed. Plugins that completed activation are recorded even when a later plugin fails. An unreadable state file is treated as empty, with a warning, and a failed state write is a warning, not a command failure. `--no-plugins` and discovery commands leave the state untouched. Release archives omit this file.

`context.events.onLayoutReady(callback)` is the equivalent of Obsidian's `app.workspace.onLayoutReady`. Before every plugin has activated, callbacks are queued; after the last `onload`, the host runs them in registration order, awaiting each, and then emits `workspace.layout-ready` before the command runs. A callback registered later runs immediately. Callback failures become warnings. Do not await work that waits for layout readiness inside `onload`.

`context.events.onQuit(task)` registers best-effort invocation-end work, like the `tasks` of Obsidian's `quit` event. At invocation end, after success or failure, the host emits `workspace.quit` with `{}`, settles immediate layout callbacks, runs quit tasks in registration order (including tasks added by quit listeners), and only then unloads plugins. Task failures become warnings and never change the command result.

## Event delivery and invocation replay

File records of `vault.create`, `vault.modify` and `vault.delete` contain `path`, `kind: "file"`, SHA-256 `revision`, byte count `bytes`, and `operation` (`created`, `updated`, or `deleted`). For deletion, revision and bytes identify the removed content. A batch first emits `vault.create` with `{path, kind: "folder", operation: "created"}` for each directory it created, parent before child, in the order the batch created them; then one `vault.rename` per moved folder or file; then one record per written or removed file in batch order; then `vault.delete` with `{path, kind: "folder", operation: "deleted"}` for each removed folder, child before parent. Moving to the trash is reported like Obsidian's `trashFile`: `vault.delete` for each trashed file, then each trashed folder, with no records for the hidden `.trash` folders; the content is retained under `.trash`. Like Obsidian, there is no load-time `create` burst: the CLI has no long-lived vault. Paths are relative to the command root reported in the response context: the environment for project management, or the selected project for file commands. Claude user-scope commands report their configuration root separately in `data.target.directory`. Events follow successful persistence; batch write events wait until the entire batch completes. Dry runs and failed writes emit no `vault.*` events. Folder paths created above a selected project's directory are outside its scope and are not reported.

Each invocation owns one bus. Payloads must be finite JSON data: primitives, arrays and plain objects; undefined, BigInt, nonfinite numbers, Dates, Maps and cycles are rejected. Definitions validate isolated snapshots before delivery, so a validator cannot mutate the recorded payload. Listeners run in registration order and are awaited. Each receives a cloned snapshot so mutation cannot affect other listeners or event history.

`on` returns an unsubscribe function; `once` unsubscribes before invoking its callback, including during reentrant emission. `onAny(listener)` subscribes to all future events, receiving an `EventRecord` with `id` and `payload`, and also returns an unsubscribe function. Named and all-event listeners share registration order. Removals during delivery take effect immediately. Listeners added during an emission join future emissions.

`await events.replay(listener)` delivers an isolated snapshot of the history retained when replay begins. It does not subscribe the listener, publish new events or reread previous invocations. Replay followed by subscription is not an atomic catch-up mechanism for concurrent emitters. Replay listeners are awaited; their failures become warnings. Recursion is bounded to 32 active ancestors in the same asynchronous delivery chain, including replay and delivery across `await`. Independent concurrent emissions and parallel sibling emissions do not consume one another's recursion budget. Completed ancestors do not count against notifications scheduled for a later turn. History retains the first 1,000 events; later events still reach live listeners but are absent from history and replay, with a truncation warning. Warnings are capped at 1,000.

For example, observe the routed command that began before activation, then subscribe to future host and plugin events without logging to stdout:

```ts
import type { EventRecord, HostEventMap, Plugin } from '../bin/data/types/sdk.js';

const observedIds: string[] = [];
const observe = (record: EventRecord) => {
  if (observedIds.length < 1000) observedIds.push(record.id);
};
let unsubscribe: (() => void) | undefined;
let unsubscribeFailure: (() => void) | undefined;

export default {
  async onload(context) {
    await context.events.replay(observe);
    unsubscribe = context.events.onAny(observe);
    unsubscribeFailure = context.events.on<HostEventMap['operation.failed']>(
      'operation.failed',
      payload => context.events.warn(`Observed ${payload.operation}: ${payload.error.code}`),
    );
  },
  onunload() {
    unsubscribeFailure?.();
    unsubscribe?.();
  },
} satisfies Omit<Plugin, 'manifest'>;
```

Synchronous throws and asynchronous listener rejections become warnings and delivery continues. Host observers cannot veto operations, replace original failures or undo committed work, even on a `started` event. Callbacks must settle; arbitrary Node plugin code has no forced timeout. Cleanup continues in reverse order after failures. A listener that unsubscribes inside its own cleanup will not receive the later `plugin.unloaded` event. Dispose removes subscriptions and rejects later bus use. Records appear in the command result; history is neither persistent replay nor a filesystem watcher.

For recovery, inspect the original `error`, native result details and committed `vault.*` records together. A command failure can follow successful writes, and a Claude failure can follow a successful native exit whose output could not be parsed. A listener warning alone does not justify retrying a write. Reread affected state and its revision before retrying; phase success during a dry run is only a preview.
