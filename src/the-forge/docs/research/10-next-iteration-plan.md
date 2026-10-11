# Next iteration plan

[Research index](README.md) · Drafted 2026-10-10 · Status: shipped, see [Status](#status)

This plan turns the [research synthesis](README.md) and the maintainer's direction into sequenced, reviewable milestones. Work proceeds one milestone per pull request, in the order M1, M1b, M2, M3, M3b, M4, M4b, M5, M6. Each milestone defines its acceptance examples first and ends with `npm run check`.

## Status

Updated 2026-10-11. Every milestone shipped as its own stacked pull request, in the planned order. Pull request #18 consolidates them, with this research (#8), into one next-iteration pull request from `claude/next-iteration`, and adds a consolidation and polish pass on top. The table records where each milestone landed. The notes below it record where the result differs from the plan, what #18 changed and what remains open.

| Milestone | Pull request | Result |
| --- | --- | --- |
| Research and this plan | #8 | Shipped; moved to `src/the-forge/docs/research/` during consolidation, because the root keeps no docs since M1b, and excluded from the packaged docs |
| M1 Agent-ready responses and a durable core | #9 | Shipped, with the showcase |
| M1b Self-contained projects and project-owned workflows | #10 | Shipped |
| M2 Vault kernel, MetadataCache and events | #11 | Shipped |
| M3 Plugin platform v2 and the first core plugins | #12 | Shipped; `skills` migrated as well |
| M3b Agent definitions with docker-agent compatibility | #13 | Shipped with stricter safety defaults |
| M4 The `backlog` core plugin | #14 | Shipped; the deferred items remain deferred |
| M4b Backlog connectors, Azure DevOps first | #15 | Shipped without dependency sync, which #18 added |
| M5 Remaining features as core plugins | #16 | Shipped as one pull request, not one per plugin |
| M6 Agent experience continued | #17 | Shipped; real-agent evaluations are opt-in only |
| Consolidation and polish | #18 | Closed most follow-ups of #9–#17; see [below](#consolidation-and-polish-18) |
| Showcase in every milestone | #9–#18 | Maintained; #18 extended it to most of M3, M5 and M6 |

### Deviations by milestone

**M1 (#9)**
- The Bases budget test uses 1,000 notes and 2,000 attachments with a 30 s budget, not 5,000 notes. 5,000 notes went from 710 s to 13 s in an offline measurement, not in the committed test.
- The error catalog grew beyond the plan: each code has a category, hint and retryable flag. The exit code follows from the category, and responses carry `error.hint` and `error.retryable`.
- The lock is owned by a random token and diagnoses staleness per PID namespace and boot id. #9 never removed it automatically; #18 removes a provably stale lock.
- The showcase landed here rather than as a separate item. Its generated UI lives in `ui/`, not `src/ui`. #9 patched its toolchain to pass the generated project's own gate; #18 made `ui/` the default output and dropped the patch.

**M1b (#10)**
- The executable was renamed from `bin/app.js` to `bin/forge.js`, although naming was out of scope. Since #18, `bin/forge.js` is a launcher for the runtime bundle `bin/forge-runtime.js`.
- The workflow drift guard became its own generated workflow, `the-forge--guard--workflows.yml`. Generated files are named `<project>--<concern>[--<file>].yml`.

**M2 (#11)**
- `delete` adds `--recursive` and protects `.obsidian`, `.forge` and `bin`. Its flags follow the plan: `--permanent` and `--allow-broken-links`.
- `metadataCache.*` events fire only when a command has loaded the cache during the invocation, not after every commit.
- A move that would make a bare `[[Name]]` ambiguous rewrites it to a full path, because Forge treats ambiguous links as unresolved. `.obsidian/app.json` link preferences are not read.

**M3 (#12)**
- Core plugins live in `src/the-forge/src/plugins/<id>/`, not `src/the-forge/plugins/<id>/`, because M1b gave The Forge a `src/` folder. The plugin SDK is the kernel's `src/application/plugins/`.
- `skills` was also migrated as a core plugin.
- Config sections live under `plugins.settings.<id>`, and `plugins.disabled` turns off a core plugin. `--no-plugins` now skips user plugins only.
- `schema` publishes option `enum` and `required`. In #12 each command validated its own values and option descriptions stayed English; #18 moved both checks into the host and localized the descriptions. `links` has no paging.

**M3b (#13)**
- Generation is safe by default. `--mcp none` is the default, and hooks need `--hooks`. Permissions need `--settings`, and broad rules are refused without `--allow-broad-permissions`. Merges touch only entries recorded in `.claude/forge-generated.json`.
- Unsupported versions are errors, not diagnostics. HCL definitions, flavors and template expansion are not supported.
- In #13, permission rules written with `--settings` were appended and never removed. Since #18 the manifest records each rule's origins, and a later run revokes a rule that no definition grants any more. The generated output is not verified against a live Claude Code.

**M4 (#14)**
- Commands go beyond the plan: `move --top|--first|--last`, `set` for horizon, priority, risk, dates, assignee and type, and `release list`.
- These platform changes were made in this milestone:
  - Bases degrades per note: a bad note becomes a warning instead of a failure, and `AMBIGUOUS_BASE_LINK` and `BASE_INDEX_ERROR` are removed.
  - Ambiguous links in Bases resolve to the closest file.
  - One plugin-state model applies (`enabled`, `unavailable`, `disabled`, `skipped`, `rejected`), with `PLUGIN_UNAVAILABLE`. #18 added `missing`.
- Still deferred: estimation writes, My Work, absences and backfill stubs. Release actions use the first `product-release` view. Obsidian's exact YAML folding is not pinned.

**M4b (#15)**
- The design changed: connection profiles live in `plugins.settings.connector.connections.<id>`, not a top-level `connectors` section. A generic `connector` core plugin owns them, provides `connector.hub` and the `connectors` command, and `connector-azure-devops` provides the platform service.
- Sync state lives in `.forge/sync/<connection>.json`, guarded by a lock file. In #15 the lock was per connection and a crash left it behind; #18 moved it to the workspace root and recovers it like the writer lock.
- #15 did not sync `dependsOn` ↔ predecessor links; #18 does. Not synced: assignee, dates and comments. Remote items without a note are not imported. Only personal access tokens are supported. The connector is tested against an in-process fake, not a live organization.
- New host ports were added for `http`, `environment` and `locks`, along with optional services and namespaced service ids.

**M5 (#16)**
- All five migrations shipped in one pull request instead of one each. Generated output was byte-identical across 118 recorded CLI calls.
- The design changed:
  - Kernel `paths` holds only `projects`. UI, data-source and template settings moved to `plugins.settings.<id>`.
  - `CommandContext.claude` was replaced by the `claude.lifecycle` service, whose types the SDK exports.
  - `claude` is no longer a host event namespace.
  - The Claude agent and hook validators stay in the kernel domain, so `agents` works without `claude`.
- The showcase gained no new demonstration in #16; #18 added the native Claude files and the data-source exchange.

**M6 (#17)**
- `vault check` ships as the core plugin `vault-check`, because `vault` is the host's event namespace. It adds `vault tags` and `vault properties`. The Forge checkout passes `vault check --strict`.
- Skills became `skills/<id>/SKILL.md` folders installed into `.claude/skills` and `.agents/skills`. User-plugin skill ids became `<plugin>-<name>`.
- The evaluation harness has 33 tasks, above the planned 20–30. In `npm run check` it runs only the reference driver. The real-agent `claude` driver is opt-in and refused in CI, and no baseline results are recorded.
- #17 left two follow-ups, both closed in #18: `vault check` took about 5.5 s on 2,000 notes, and `backlog set`, `move` and `depend` published `idempotentHint: false`. `trace check` remains future work.

**Showcase**
- Each milestone regenerated the showcase, and `npm run showcase:check` guards against drift. Since #18 it is the last stage of `npm run check`. The script is `scripts/showcase.mjs` with modules in `scripts/showcase/`.
- It does not yet demonstrate `plugins`, `--events`, `connectors test`, or `backlog sync status|resolve`. Its plan and sync runs are dry runs.

### Consolidation and polish (#18)

Five review-driven slices (kernel performance, connectors and backlog, agent contract, docs and localization, tests and showcase), their fix rounds and a final contract round changed:

- **Metadata cache.** Parse results and link resolutions persist in the workspace's `.forge/cache` (`metadata.v2.*`) and are reused by file stamp and content revision. A warm `vault check` on 2,000 notes takes about 0.5 s instead of 5.5 s; `links`, `search` and `bases query` gain likewise. `npm run bench` measures it.
- **Locks.** A writer or sync lock whose holder provably no longer runs is broken atomically, with a warning; any other lock is refused with `details.stale` (`active`, `unknown` or `stale`) and a per-occurrence `retryable`. The sync lock lives at the workspace root whatever the scope. SIGINT or SIGTERM stops a live sync at the next safe point with `SYNC_INTERRUPTED`.
- **Dependencies.** `dependsOn` syncs with Azure DevOps predecessor links in both directions. A link changed on the other end during an update is reported as `SYNC_CONFLICT`.
- **Agent contract.** The host enforces each option's `enum` and `required` before the command runs (`INVALID_OPTION_VALUE`, `MISSING_ARGUMENT`), including comma-separated list options and the global `--events`. Idempotent and destructive hints were corrected, and `tests/cli/idempotency.e2e.test.ts` repeats every mutating mode to check them. Every command and generator declares the error codes it raises. A static test maps the codes raised in each plugin's and kernel command module's own source to those declarations; codes a plugin command reaches only through kernel ports (such as `NOT_FOUND` from a file read) are checked by `tests/cli/declared-failures.e2e.test.ts`, a table of failing invocations, and only for the commands it lists. A reader that closes the output pipe early no longer crashes the CLI, and a closed standard error never ends a command.
- **Plugins.** Permission rules generated with `--settings` are tracked with their origins and revoked once no definition grants them. An enabled user plugin without a manifest is listed as `missing` instead of failing every command, and a plugin whose required provider is missing becomes `unavailable`.
- **Localization.** The policy in `docs/reference/language.md` is applied: option, argument and settings descriptions, plugin names, host warnings, plugin state reasons and coded findings (backlog check, sync skips, Bases, agents, claude) read in German with `--lang de`. A parity test covers every catalog.
- **Showcase.** It now demonstrates a committed `apply`, `edit --edits` and `--block`, `move` with link rewriting, `vault tags` and `vault properties`, `links`, native Claude hooks and plugin files, the data-source exchange and a contract section with `schema`, German `help` and `skills`.
- **Toolchain.** Vitest 5 with explicit per-level test budgets and an asynchronous CLI harness; `npm audit` reports 0 vulnerabilities in the Forge and the showcase. Actions are pinned by SHA to Node 24 releases. `bin/forge.js` enables Node's compile cache before it loads `bin/forge-runtime.js`.
- **UI output.** `make ui` and `make stories` write to `ui/<target>/components` and `ui/<target>/stories` by default, outside the generated project's library checks; `tests/ui/ui-project-gate.e2e.test.ts` runs that gate for all seven targets.
- **Evaluations.** The `claude` driver runs the agent as a process group and ends it on a timeout or a signal. It isolates MCP servers and plugins, gives Forge an allowlisted environment, redacts secrets and exits 1 when an attempt fails. It is tested against a fake `claude` only.

Still open after #18:

- Remote items without a note are not imported. A Bases filter has no WIQL equivalent, and `bases query` cannot test a planned note against the filter without writing it, which would break dry runs.
- Personal access tokens only, no Microsoft Entra ID. Assignee, dates and comments are not synced. Whether a link change revises the target item, and `multilineFieldsFormat` on reads, are not verified against a live organization.
- A link removed by position can still hit the wrong relation when the item changes on the other end. The sync detects this and reports a conflict, but cannot prevent it.
- On macOS and Windows a lock records no process start time, so a lock whose pid was reused by a live process stays `active`.
- No real-agent evaluation run has been executed, and no baseline is recorded.
- `links` has no paging, `.obsidian/app.json` link preferences are not read, and `trace check` is not started.
- Generated UI placed under a project's `src/` instead of the default `ui/` passes the project's lint and typecheck, but not its library analysis: nothing imports it, and the frameworks are not dependencies of the generated library.
- Notes with thousands of separate lists parse slowly (micromark copies its event list per list; about 3.3 s for 4,000). Each content version is parsed once and then served from the metadata cache.

### Decisions

| Decision | Outcome |
| --- | --- |
| Event naming | Adopted in M2: `vault.*` and `metadataCache.*`, with `workspace.*` phase records renamed to `operation.*` and no aliases |
| Default event output | Adopted in M1/M2: `changes`, settable as `settings.events` |
| Delete semantics | Adopted in M2: `.trash/` by default, `--permanent` to remove |
| Core plugin source layout | Changed: `src/the-forge/src/plugins/<id>/<layer>/`, following M1b |
| Backlog first cut | Adopted in M4, plus horizon, priority, risk, dates and assignee edits |
| Milestone order | Kept: M1 → M1b → M2 → M3 → M3b → M4 → M4b → M5 → M6 |
| Agent definitions | Adopted in M3b: docker-agent YAML is the source; Claude agents are generated with opt-in risky output |
| Connectors | Adopted in M4b for Azure DevOps; the profiles moved under `plugins.settings.connector`; GitHub and Jira not started |
| Project independence | Adopted in M1b |
| Workflow wiring | Adopted in M1b, with a separate guard workflow |

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

### Showcase project, maintained in every milestone

A fully generated example project is committed under `src/forge-showcase/` as a managed Forge project. It demonstrates the app's capabilities end to end on a small fictional web product, with:
- a vault of interlinked specs, docs, Canvas and Bases;
- domain and application components;
- forms;
- data sources with adapters and fixtures;
- a component library generated for every UI target, with stories;
- once M4 lands, a backlog compatible with backlog-view.

A deterministic script, `scripts/showcase.mjs`, regenerates it by driving the bundled CLI with fixed inputs and dates. It keeps everything inside the showcase project and preserves the checkout's project selection. A test regenerates the showcase and fails on drift. Every milestone that adds a user-visible capability extends the script and commits the regenerated showcase.

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

### M1b: Self-contained projects and project-owned workflows

Every project under `src/` is fully independent and self-contained, The Forge included.

- **The Forge moves in.** Its `package.json`, lockfile, `tests/`, `scripts/`, `configs/`, build and test configuration, and product documentation move into `src/the-forge/`. Runtime source moves to `src/the-forge/src/<layer>/<concern>/`, the same layout as generated projects. The repository root becomes a thin workspace: the shipped `bin/` distribution, the workspace `README.md`, `AGENTS.md`, `LICENSE`, `.gitattributes` and the synced `.github/workflows/`. Building The Forge still produces the workspace `bin/` distribution, preserving checkout configuration and selection. `AGENTS.md` and all docs describe the new layout.
- **Project-owned workflows.** Each project authors its CI workflows, grouped by concern, under `<project>/src/infrastructure/workflows/<concern>/`. A new `workflows sync` command generates the root `.github/workflows/<project>--<concern>.yml` copies that GitHub requires. Each copy is scoped to its project's paths and its working directory is set to the project. `workflows sync --check` exits non-zero on drift, and a root guard workflow runs that check. The authored files are the single source of truth.
- **The showcase is self-contained.** It has its own toolchain, lockfile, generated test suite and workflows. Its own CI runs `npm ci` and `npm run check` inside `src/forge-showcase`.
- **Acceptance:**
  - `npm ci && npm run check` succeeds inside `src/the-forge` and inside `src/forge-showcase`, each without the other.
  - `workflows sync --check` passes.
  - CI runs each project's workflows.
  - The repository root contains no project toolchain.

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

### M3b: Agent definitions with docker-agent compatibility

Users create and maintain agent definitions for their environment in [docker-agent](https://github.com/docker/docker-agent) YAML. Claude Code agents are generated from those definitions. The format and the mapping are recorded in the [docker-agent contract](11-docker-agent-contract.md).

- **New core plugin `agents`.** Definition files live at `<scope>/agents/*.yaml`, a path set by the plugin's config section. One file can define a team of agents, exactly as in docker-agent. Forge stores the files verbatim and preserves comments.
- **Validation.**
  - The vendored docker-agent JSON Schema (draft-07, v16, strict) is pinned to a recorded docker-agent commit, refreshed by a script, and tested against docker-agent's own `examples/*.yaml`.
  - Forge then applies docker-agent's semantic checks: agent references resolve, `instruction` and `instruction_file` are exclusive, `force_handoff` has no cycles, and models resolve.
  - Versions other than absent or `"16"` get a diagnostic.
- **Commands:**
  - `agents list|inspect|validate`
  - `agents create <name> [--from-template …]`, which writes valid docker-agent YAML
  - `agents import --from claude <agent>`, which converts a Claude agent into docker-agent YAML (approximate, with diagnostics)
  - `agents generate --target claude [--agent <name>] [--plan|--check|--dry-run] [--revisions-from …]`
- **Generation** follows the same pattern as UI generation:
  - It writes `.claude/agents/<name>.md` for each agent: frontmatter from the mapping table and the instruction as the body.
  - Merging MCP servers into `.mcp.json`, permissions and the main agent into project settings, and commands into `.claude/skills/` are each opt-in.
  - Every unmapped field becomes a diagnostic with severity, code, JSON pointer and fidelity.
  - Generated files carry `x-forge-source` provenance. `--check` detects drift with exit 5, and regeneration is revision-guarded.
  - It reuses the existing `claude` validation for the generated agent files.
- **Events:** `agents.generated`, plus normal `vault.*` records.
- **Showcase:** a docker-agent team (a root agent with sub-agents, an MCP toolset and a command) with its generated Claude agents.
- **Acceptance:**
  - Every docker-agent example in the pinned commit validates.
  - Generation from `dev-team.yaml`, `mcp-definitions.yaml` and `agent_switching_commands.yaml` produces stable files and diagnostic sets.
  - The generated agents pass Forge's Claude agent validation.
  - `--check` reports drift after a hand edit.

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

### M4b: Backlog connectors, starting with Azure DevOps Boards

The backlog connects to external work trackers through dedicated, configurable connectors. Each connector is a self-contained plugin service built on a shared connector contract, so GitHub Issues/Projects and Jira can be added later without changing the backlog or the sync engine.

- **Connector contract.** A connector implements one port: authenticate, query remote items by id or changed-since, create, update, and map between remote items and backlog items. Connectors live in `src/the-forge/src/plugins/connector-<platform>/` and are registered as core plugins. The connector-independent **sync engine** lives in the `backlog` plugin. It owns the item mapping, the per-field three-way comparison, conflict detection and the guarded vault writes. The HTTP transport is an infrastructure adapter behind a port, and tests use a recorded fake of each platform's REST API with no live calls.
- **Connection profiles in workspace config.** A validated `connectors` config section (contributed by the plugin under plugin contract v2) defines named connections. For Azure DevOps each connection has:
  - the organization URL and the project;
  - optionally an area path and an iteration root;
  - the credential source: the name of an environment variable that holds a personal access token (default `AZURE_DEVOPS_EXT_PAT`), with an optional later Entra ID / `az` CLI token source;
  - type, state and field mappings, with defaults for the Agile, Scrum and Basic processes.

  Secrets are never stored in config or notes, and responses redact credential values. One repository can define any number of connections to different organizations and projects.
- **Bases as the sync baseline.** The user creates a `.base` with several views. Each view's query defines the set of backlog items held in sync, and a view option `connection: <id>` binds the view to a connection, so different views can sync different item sets to different organizations or projects. `backlog sync` without arguments syncs every bound view. `--base <file> --view <name>` limits the run to one view.
- **Two-way sync with explicit conflicts.**
  - Vault changes push to Azure DevOps, and remote changes pull into the notes.
  - For each item and connection Forge stores sync state: the remote id and URL, the remote revision, and the field hashes from the last successful sync. The remote URL also goes into a visible frontmatter link property that opens in Obsidian.
  - A field that changed on one side only is synced. A field that changed on both sides is a conflict: it is reported and left untouched until it is resolved with `backlog sync resolve <item> --take local|remote [--field …]`.
  - Items the view query no longer returns are not deleted remotely. They are reported as "left the sync set".
- **Mapped fields in increment one:**
  - title;
  - type (Epic, Feature, PBI/User Story, Task, Bug, Issue);
  - state, mapped to backlog states;
  - parent hierarchy, through work item links;
  - iteration and area path;
  - priority, effort/story points and tags;
  - description, with the Markdown note body converted to the format Azure DevOps expects.

  Fields that are not mapped are preserved on both sides. Dependencies (`dependsOn` ↔ predecessor links) are included if they fit the increment, otherwise they follow.
- **Commands:**
  - `connectors list|inspect|test <id>`: validates config and runs an authenticated, read-only probe.
  - `backlog sync [--base … --view …] [--dry-run] [--direction push|pull|both]`: by default both directions.
  - `backlog sync status`: shows pending changes and conflicts without writing.
  - `backlog sync resolve …`: settles a conflict in favor of one side.

  Every remote write is planned first. `--dry-run` shows the planned remote operations and vault diffs without writing anywhere, while still reading the remote.
- **Events:** `connector.pushed`, `connector.pulled`, `connector.conflict`, `backlog.synced`, plus normal `vault.*` records for note changes.
- **Showcase:** the showcase gains a connectors config example, using a fake connection in tests, and a sync Base with two views bound to two different connections.
- **Acceptance:**
  - Against the recorded Azure DevOps fake: an initial push creates work items with a correct hierarchy, and a remote state change pulls into the note.
  - A concurrent title change on both sides is reported as a conflict and changes nothing.
  - `--dry-run` writes nothing.
  - Two views sync to two organizations from one repository.
  - Credentials never appear in output.

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
| Milestone order | M1 → M1b → M2 → M3 → M3b → M4 → M4b → M5 → M6 (M1b, M3b and M4b added on request) |
| Agent definitions | docker-agent YAML is the source of truth; Claude agents are generated from it (requested) |
| Connectors | Two-way sync with explicit conflicts; connection profiles in workspace config; Azure DevOps first, then GitHub and Jira (approved) |
| Project independence | Every project under `src/`, The Forge included, is self-contained with its own toolchain, tests and workflows (approved) |
| Workflow wiring | Project-authored workflows synced into `.github/workflows/` by `workflows sync`, drift-checked in CI (approved) |
