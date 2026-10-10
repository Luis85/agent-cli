# Next iteration plan

[Research index](README.md) · Drafted 2026-10-10 · Status: proposal for review

This plan turns the [research synthesis](README.md) and the maintainer's direction into sequenced, reviewable milestones. Work proceeds one milestone per pull request. Each milestone defines its acceptance examples first and ends with `npm run check`.

## Product direction

The Forge is a **terminal project companion**: a file-based, Git-backed, multi-project toolkit for AI-assisted product and software development.

- **Two interfaces, one vault.** The user lives in Obsidian, where design, concepts, specs, docs and code are consumed and edited. The agent has its own fully independent CLI. It can do everything with the vault that the user can do in Obsidian, without Obsidian running or installed.
- **Native formats.** Everything is saved as Markdown, Canvas and Bases, so it is fully Obsidian compatible without depending on Obsidian.
- **Connected, verifiable output.** Documentation, design, specs, backlog and code form an automatically interconnected knowledge graph. Output is checked and verified deterministically.
- **Design to production.** Web UI work runs from design through prototype to production.
- **Extensible by design.** A small core ships with bundled **core plugins** that deliver the vision. Users and their agents add capabilities as plugins. A plugin packages everything needed for a great agent experience: commands, contracts, events, skills, documentation and localized text.

**Current focus:** stability, performance, feature development and ease of use. **Not in scope now:** npm publishing, tagged releases and naming.

## Target architecture

### Kernel

The kernel keeps only what every capability depends on. It stays in the existing `src/the-forge/<layer>/<concern>/` layout:

| Kernel concern | Responsibility |
| --- | --- |
| CLI shell | Routing, global options, the JSON envelope, a help and schema catalog generated from command metadata, the i18n registry |
| Configuration | Workspace config with plugin-contributed, schema-validated sections |
| Workspace and scope | Projects, selection, stateless `--project`, path containment |
| Vault | `FileRepository` gains stat, rename and folders. A file-kind and codec registry covers Markdown, Canvas, Base, UTF-8 text and binary. Guarded write orchestration provides revisions, dry runs with diffs, a lock with owner metadata, fsync and rollback |
| MetadataCache | A link, embed, tag, heading, block and frontmatter-link index with positions, plus `resolvedLinks` and `unresolvedLinks`. It is built lazily per invocation and updated after commits. This lifts and extends the index that today lives only in `infrastructure/bases` |
| FileManager | `renameFile` with link rewriting, `processFrontMatter`, and `trashFile`. These live in the kernel because link integrity and events cut across every feature |
| Event bus | Obsidian-parity events, event ownership, opt-in output |
| Plugin host | Manifests, lifecycle, contributions, a service registry, and enabling and disabling plugins, core plugins included |

### Core plugins

Core plugins live in `src/the-forge/plugins/<plugin-id>/`, with their own `domain`, `application`, `infrastructure` and `presentation` folders and a `plugin.ts` entry. They are bundled and enabled by default, and can be disabled in config, like Obsidian's core plugins.

They depend only on the kernel's application ports and domain contracts through the SDK. They never import another plugin directly; they use declared services instead. Architecture and structure checks are extended to enforce this, and `AGENTS.md` and `src/the-forge/README.md` are updated with the new rule.

| Core plugin | Commands | Origin |
| --- | --- | --- |
| `search` | `search` | new |
| `links` | `links out\|back\|unresolved\|orphans` | new, built on MetadataCache |
| `bases` | `bases …` | migrated |
| `backlog` | `backlog …` | new, compatible with backlog-view |
| `templates` | `templates`, `make document` | migrated |
| `scaffolds` | `make entity\|value-object\|use-case\|event\|form\|plugin` | migrated |
| `ui` | `components`, `interactions`, `make ui\|stories` | migrated together, since interactions are coupled to the renderers |
| `data-sources` | `data-sources`, `make data-source` | migrated |
| `claude` | `claude …` | migrated |

Document commands (`list`, `read`, `create`, `write`, `edit`, `properties`, `patch`, `validate`, `delete`, `move`) remain kernel commands. They are the agent's equivalent of Obsidian's built-in file operations.

### Plugin contract v2

A review of the current registry, SDK and composition root found 12 capabilities that features need but plugins cannot reach today. Plugin contract v2 closes them:

1. **Command metadata.** Each command declares:
   - its scope (workspace or project) and whether it is a discovery command, which `invocationPolicy` consumes instead of hard-coded IDs;
   - read-only or mutating;
   - its options as JSON Schema (description, required, enum, default), an output schema, and its error codes.
2. **Namespaces.** Core plugins may own reserved bare command IDs (`bases`, `backlog`). User plugins keep the `<id>.` prefix.
3. **Config sections.** A plugin can contribute a validated config section. Plugin settings live in that section, which also lets the host detect external changes.
4. **Generators** receive options, flags and context, and use the shared plan, check and drift service.
5. **Services.** A plugin can provide or require named services, for example ui requiring interactions or setup requiring templates and skills.
6. **Strings.** Plugins contribute localized strings and result localizers, so English and German stay complete.
7. **Event ownership.** A plugin may emit only its own events, and the host's events stay host-owned.
8. **Root-scope access** for workspace-scoped plugins, and stat, rename and folder operations on the repository port.
9. **An Obsidian-shaped `app` facade** in the SDK, shown below.

| Facade | Members |
| --- | --- |
| `app.vault` | `read`, `create`, `modify`, `process`, `append`, `trash`, `delete`, `rename`, `getMarkdownFiles`, `on('create'\|'modify'\|'delete'\|'rename')` |
| `app.metadataCache` | `getFileCache`, `getFirstLinkpathDest`, `resolvedLinks`, `unresolvedLinks`, `on('changed'\|'deleted'\|'resolve'\|'resolved')` |
| `app.fileManager` | `renameFile`, `processFrontMatter`, `trashFile` |
| `app.workspace` | `onLayoutReady`, `on('file-open'\|'quick-preview'\|'quit')`, the active project |

The facade lets authors familiar with Obsidian write Forge plugins, and lets logic be ported from Obsidian plugins such as backlog-view. Every member honors revision guards and dry runs.

### Event parity

These events follow the [Obsidian event model](08-obsidian-event-model.md). Before the first release, contracts change directly, so the current `file.*` events are replaced rather than aliased.

| Obsidian | Forge event | Emitted when |
| --- | --- | --- |
| `vault.create`, `modify`, `delete`, `rename(oldPath)` | `vault.create`, `vault.modify`, `vault.delete`, `vault.rename` (`{path, oldPath}`); folders carry `kind: "folder"` | After each committed write, in batch order. A link-rewriting rename also emits `vault.modify` for every rewritten note |
| `metadataCache.changed(file, data, cache)` | `metadataCache.changed` (`{path, cache}`) | After a commit re-indexes a Markdown file |
| `metadataCache.deleted(file, prevCache)` | `metadataCache.deleted` | After a delete, with the previous cache |
| `metadataCache.resolve(file)` / `resolved()` | `metadataCache.resolve` / `metadataCache.resolved` | After link resolution for a file / after each committed batch |
| `onLayoutReady` | `workspace.layout-ready` plus `app.workspace.onLayoutReady` | Plugins are loaded and the index can be queried. There is no load-time `create` burst |
| `file-open` | `workspace.file-open` | A command reads a file |
| `quick-preview` | `workspace.quick-preview` | A dry run previews a modification |
| `quit(tasks)` | `workspace.quit` with best-effort tasks | The invocation ends |
| `active-leaf-change` | `workspace.project-change` | `project open` or `project close` changes the selection |
| `onload`, `onunload` | plugin lifecycle hooks and `plugin.*` records | Unchanged |
| `onUserEnable` | `onUserEnable` hook | First activation after the plugin is enabled, tracked in workspace data |
| `onExternalSettingsChange` | hook | The plugin's config section changed since its last activation |
| Editor, menu, layout and window events | none | No headless meaning. Command contributions replace menu extension points |

The Forge-specific phase records `command.*` and `claude.*` stay. The `workspace.started`, `workspace.succeeded` and `workspace.failed` records are renamed to `operation.*`, so the `workspace.*` namespace means the same thing as in Obsidian.

The response gains `--events none|changes|all`, also settable in `settings`, defaulting to `changes`:
- `changes` returns only `vault.*` records.
- `all` returns the full history.

Delivery to listeners and `replay` are unaffected by this flag.

## Milestones

### M1: Agent-ready responses and a durable core

These items need no architecture change and ship first.

| Item | Acceptance examples |
| --- | --- |
| Opt-in event output | `read` returns no events by default. `write` returns only its `vault.*` records. `--events all` returns the current full history |
| No duplicated read output | A Markdown `read` returns `content` and `properties`; `--parts body` adds `body` |
| UTF-8 text kind | `read x.ts` returns `kind: "text"` with UTF-8 content. `edit` and `write` work on text files. Binary files keep base64 |
| Diffs in dry runs | Dry-run `edit`, `write`, `properties` and `patch` return a unified `diff`. `--if-match` is accepted on a dry run and reports the same conflict as the real write |
| Durable writes | The temp file and its parent directory are fsynced before the rename, guarded on Windows. The lock records pid, host, start time, command and operation id. `WORKSPACE_BUSY` reports the holder and whether it looks stale |
| Linear Bases | File contexts and the link-resolution map are built once per query, and link resolution uses indexed maps. A 5,000-note fixture query stays within a budget test, against 142 s before |
| Cross-platform CI | Ubuntu, Windows and macOS × Node 22.12 and 24. `.gitattributes` sets LF endings. Tests cover CRLF revisions and case-only renames |
| Error catalog | Every thrown code is documented, which a test enforces. `NO_MATCH` is split from `AMBIGUOUS_EDIT`. `CONFLICT` includes the current revision |

### M2: Vault kernel, MetadataCache and events

- Lift the index into a kernel MetadataCache. Add headings, block IDs, aliases, positions, display text and subpaths, plus `resolvedLinks` and `unresolvedLinks`. Bases consumes it.
- Add `delete`. It uses `--if-match`, moves files to `.trash/` by default (Obsidian's "move to Obsidian trash" behavior), and refuses to delete notes that still have backlinks unless `--allow-broken-links` is given.
- Add `move`/`rename`. It rewrites wikilinks, embeds, Markdown links, frontmatter links and Canvas file nodes, preserving subpaths and display text. A dry run lists every affected note with diffs, and all changes commit as one batch.
- Emit the event parity table above, and add the `app` facade to the SDK.
- **Acceptance:** renaming a note referenced from frontmatter, body text and a Canvas file produces one batch. The events are `vault.rename`, then `vault.modify` for each referrer, then `metadataCache.changed` and `metadataCache.resolved`. Obsidian sees no broken links.

### M3: Plugin platform v2 and the first core plugins

- Implement plugin contract v2, core plugin bundling and enable/disable, the source layout and its architecture rules, and command metadata driving schema, help and invocation policy.
- Deliver `search` and `links` as new core plugins and migrate `bases` as the proof.
- **Acceptance:**
  - Disabling `bases` removes its commands from `schema`.
  - A user plugin can call `app.metadataCache.getFileCache`, contribute a config section and German strings, and react to `vault.rename`.
  - Architecture tests reject a plugin-to-plugin import.

### M4: The `backlog` core plugin

The plugin is compatible with backlog-view 0.10.0 and its unreleased global rank, following the [contract](09-backlog-view-contract.md). The backlog's `.base` view options are the configuration source of truth.

| Command | Behavior |
| --- | --- |
| `backlog init [--folder docs]` | Writes the plugin's exact `Product Backlog.base` scaffold |
| `backlog list` / `tree` / `board` / `show <item>` | Hierarchy, ranks, states, WIP limits, iteration and release membership as JSON, evaluated through the Bases engine |
| `backlog add <type> <title> [--parent …]` | Uses the plugin's file name sanitizing, type folders, key order, `pbl-id` and end-of-siblings rank |
| `backlog move <item> --parent/--before/--after` | Applies the plugin's rank arithmetic and refuses when no gap remains |
| `backlog ranks seed\|respace` | Renumbers ranks the way the plugin's commands do |
| `backlog set <item> --state …` | Applies the started and finished stamping rules and enforces `mayHoldField` |
| `backlog depend` / `undepend` | Maintains `dependsOn` lists |
| `backlog iteration add\|assign` | Uses the plugin's naming and date defaults |
| `backlog release add\|join\|mark-released\|readiness\|notes` | Release notes are byte-compatible, including the generation marker |
| `backlog check` | Reports parent and dependency cycles, broken links, unresolved memberships, config problems and type/field violations |

All writes go through guarded `processFrontMatter`, with the plugin's refusal rules and YAML style.

- **Events:** `backlog.item-created`, `backlog.item-moved`, `backlog.state-changed`, `backlog.released`.
- **Skill:** a `forge-backlog` skill covering planning, decomposition and release work.
- **Acceptance:** conformance fixtures copied from backlog-view (its `docs/Product Backlog.base` and plugin-written notes) round-trip unchanged. Notes created by Forge match the plugin's create output byte for byte, in a fixture-based comparison.
- **Deferred:** estimation writes, My Work and absences, which Forge reads but does not edit yet.

### M5: Migrate the remaining features into core plugins

Migrate `templates`, `scaffolds` (including forms), `ui` (with interactions), `data-sources` and `claude` one per pull request. Generated-project output contracts are preserved. Each migration moves its tests under `tests/<plugin>/` and updates docs, skills and localization.

### M6: Agent experience continued

- `schema` becomes a JSON Schema contract with per-command errors and annotations.
- Multi-edit and `apply <plan.json>`.
- Section-targeted edits by heading or block.
- `vault check` lint and tag and property inventories.
- Skills move to Agent Skills folders and install into both `.claude/skills` and `.agents/skills`.
- An agent evaluation harness of 20–30 tasks runs through real agents with state verification.

The knowledge-graph vision builds on M2 and M6. Specs, backlog items, docs and code link through wikilinks and frontmatter. `links` and `vault check` verify that graph deterministically, and a later `trace check` verifies requirement-to-test coverage.

## Decisions needed

| Decision | Recommendation |
| --- | --- |
| Event naming | Use Obsidian names (`vault.create`, `metadataCache.changed`) and rename `workspace.*` phase records to `operation.*`, with no aliases, as allowed before release |
| Default event output | `changes`. Reads stay lean while writes still report `vault.*` records |
| Delete semantics | Move to `.trash/` by default, with `--permanent` to remove |
| Core plugin source layout | `src/the-forge/plugins/<id>/<layer>/…`, with the kernel staying in the existing layer folders |
| Backlog first cut | Items, hierarchy, ranks, states, dependencies, iterations and releases; estimation, My Work and absences read-only for now |
| Milestone order | M1 → M2 → M3 → M4 → M5 → M6. M4 could follow M2 directly if the backlog is more urgent than the plugin platform, at the cost of migrating it later |
