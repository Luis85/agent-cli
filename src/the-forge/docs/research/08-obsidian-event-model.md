# Obsidian event model

[Research index](README.md) · Researched 2026-10-10

This page is the reference for the event parity required by the [next iteration plan](10-next-iteration-plan.md). The primary source is `obsidian.d.ts` from [obsidianmd/obsidian-api](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts), package version 1.14.4; `master` is the canonical branch. The [CHANGELOG](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/CHANGELOG.md) stops at 1.7.2, so this page uses the `@since` tags in the d.ts to date additions. Entries marked *unverified* describe behavior the d.ts does not state.

## Event base and plugin lifecycle

| API | Signature | Notes |
| --- | --- | --- |
| `Events.on` / `off` / `offref` | `on(name, callback, ctx?) → EventRef` | Base emitter, 0.9.7 |
| `Events.trigger` | `trigger(name, ...data)` | Runs every listener in order, even when some throw |
| `Events.tryTrigger` | `tryTrigger(ref, args)` | A listener error is rethrown asynchronously, so it does not interrupt the caller |
| `Component.onload` / `onunload` / `registerEvent` | | Listeners registered through `registerEvent` are detached on unload |
| `Plugin.onload` | `() → Promise<void> \| void` | Called when the plugin loads |
| `Plugin.onUserEnable` | `() → void` | 1.7.2. One-time setup after the user explicitly enables the plugin |
| `Plugin.onExternalSettingsChange` | `() → any` | 1.5.7. `data.json` changed on disk outside Obsidian, for example by Sync or an external program |
| `Plugin.registerCliHandler` | `(command, description, flags, handler)` | 1.12.2. Handler returns a string. Ids are `<plugin-id>` or `<plugin-id>:<action>` |
| `Workspace.onLayoutReady` | `(callback) → void` | Runs immediately if the layout is ready, otherwise queues. There is no `layout-ready` event overload in the current d.ts |

`App` is not an emitter. It exposes `vault`, `metadataCache`, `workspace` and `fileManager`.

## Vault events

All four are `@since 0.9.7`.

| Event | Callback | Semantics |
| --- | --- | --- |
| `create` | `(file: TAbstractFile)` | Fires when a file is created. It also fires for every existing file during vault load unless the handler is registered inside `onLayoutReady` ([load-time guide](https://docs.obsidian.md/plugins/guides/load-time)). Folders are included. |
| `modify` | `(file: TAbstractFile)` | Fires when a file is modified. *Unverified:* it also fires for external edits picked up by the watcher. |
| `delete` | `(file: TAbstractFile)` | Fires for both files and folders. |
| `rename` | `(file: TAbstractFile, oldPath: string)` | Covers moves as well. `file.path` holds the new path. |

The d.ts documents these vault mutators: `create`, `createBinary`, `createFolder`, `modify`, `modifyBinary`, `append`, `appendBinary` (1.12.3), `process` (atomic), `copy`, `rename`, `delete(file, force?)` and `trash(file, system)`. `Vault.rename` does not update links; `FileManager.renameFile` does.

## MetadataCache events

| Event | Callback | Semantics |
| --- | --- | --- |
| `changed` | `(file: TFile, data: string, cache: CachedMetadata)` | Fires when a file has been indexed and its updated cache is available. It does **not** fire on rename; listen for `Vault rename` instead. |
| `deleted` | `(file: TFile, prevCache: CachedMetadata \| null)` | Passes a best-effort previous cache, which may be `null` |
| `resolve` | `(file: TFile)` | Fires when the file's `resolvedLinks` and `unresolvedLinks` entries are updated |
| `resolved` | `()` | Fires when all files are resolved. It fires again after each later batch of modifications |

**Link maps:**
- `resolvedLinks` maps a source path to `{ destination path → count }`.
- `unresolvedLinks` maps a source path to `{ link text → count }`.

**Accessors:** `getFileCache`, `getCache(path)`, `getFirstLinkpathDest(linkpath, sourcePath)` and `fileToLinktext`.

**`CachedMetadata`** has these fields, all optional:
- `links`, `embeds`, `tags`, `headings`, `sections`, `listItems`
- `frontmatter`, `frontmatterPosition` (1.4.0), `frontmatterLinks` (1.4.0, `Reference & {key}`)
- `blocks` (`Record<id, {id}>`)
- `footnotes` (1.6.6), `footnoteRefs` (1.8.7), `referenceLinks` (1.8.7)

Supporting types:
- `Reference` is `{link, original, displayText?}`.
- `CacheItem` is `{position: {start, end}}`, where each point is a `{line, col, offset}` location.

## Workspace events

| Event | Callback | Since |
| --- | --- | --- |
| `quick-preview` | `(file, data)`: active Markdown modified before save | 0.9.7 |
| `file-open` | `(file \| null)`: active file changed | 0.10.9 |
| `active-leaf-change` | `(leaf \| null)` | 0.10.9 |
| `layout-change`, `resize`, `css-change` | `()` | 0.9.x |
| `window-open`, `window-close` | `(win, window)` | 0.15.3 |
| `file-menu`, `files-menu`, `url-menu`, `editor-menu` | `(menu, …)` | 0.9.12–1.5.1 |
| `editor-change`, `editor-paste`, `editor-drop` | `(…, editor, info)` | 1.1.x |
| `quit` | `(tasks: Tasks)`: best-effort cleanup before the app quits | 0.10.2 |

`WorkspaceLeaf` also emits `pinned-change` and `group-change`. The d.ts adds no new `on()` overloads in 1.8–1.14. Recent additions are Bases (`BasesView.onDataUpdated`, 1.10.0), `SecretStorage`, `appendBinary`, `registerCliHandler` and `Plugin.settings` (1.13.0).

## FileManager operations

The d.ts documents what these methods do, not which events they emit. The "Events" column is therefore *unverified*, based on observed behavior.

| Method | Purpose | Events |
| --- | --- | --- |
| `renameFile(file, newPath)` | Rename or move, updating links according to user preferences | `Vault rename`, then `modify` and `changed` for each rewritten backlinking note, then `resolve` and `resolved` |
| `processFrontMatter(file, fn)` | Atomic frontmatter read-modify-write | `modify`, `changed`, `resolved` |
| `trashFile(file)` | Move to `.trash/` or the system trash, according to settings | `delete`, `deleted` |

## Headless classification

| Class | Events | Headless meaning |
| --- | --- | --- |
| Vault | `create`, `modify`, `delete`, `rename(oldPath)`, folder variants | Post-commit records for each guarded write. There is no load-time `create` burst, because the CLI has no long-lived vault load. |
| Metadata | `changed`, `deleted`, `resolve`, `resolved` | Derived index updates after a commit. `resolved` follows each committed batch. |
| Lifecycle | `onload`, `onunload`, `onUserEnable`, `onExternalSettingsChange`, `onLayoutReady` | The plugin host lifecycle: first enable, plugin settings changed between invocations, index ready |
| Workspace analogues | `file-open` (a read), `quick-preview` (a dry-run preview), `quit` (invocation end, with best-effort tasks), `active-leaf-change` (project selection changed) | Optional analogues with weak but useful semantics |
| UI only | layout, resize, CSS, window, leaf, menu and editor events | No headless equivalent. Command contributions replace menu extension points. |

## Official Obsidian CLI

The [CLI](https://obsidian.md/help/cli) requires the 1.12 installer and a running Obsidian app. Its help page documents no event, hook, watch or subscribe commands. The only plugin extension point is `registerCliHandler`. Obsidian Headless ([announcement](https://obsidian.md/changelog/2026-02-27-sync)) is a sync client with no event API found in search results.
