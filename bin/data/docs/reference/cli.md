# Command reference and agent protocol

[Documentation](../index.md) · Reference

Run `node bin/forge.js [routing options] <command> [options]`. Routing options `--root <directory>` and `--no-plugins` must precede the command because they select the workspace and loaded command catalog. For example, `node bin/forge.js --root /path/to/workspace --no-plugins setup --dry-run`.

Commander accepts `--json`, `--no-json`, `--dry-run`, `--no-dry-run`, `--events none|changes|all`, `--lang en|de` and `--help` (`-h`) before or after the command. Use `node bin/forge.js --version` (`-V`) to inspect the executable version. Prefer `--key=value` for literal values beginning with `--`; use `--` to stop option parsing. Unknown, repeated or misplaced routing options are errors. Negated boolean flags override configuration defaults. `--no-plugins` skips configured user plugins for one invocation; bundled core plugins still load. See [configuration precedence](configuration.md) and [language selection](language.md).

## Output and errors

Every built-in invocation emits one JSON document on stdout, with no prompts or ANSI sequences. A committed write returns its `vault.*` change records, including a `kind: "folder"` record for each parent folder it created:

```json
{"ok":true,"data":{"dryRun":false,"changes":[{"path":"notes/plan.md","revision":"9f2c…","operation":"created","bytes":18}]},"context":{"workspaceRoot":"/workspace","root":"/workspace","project":null},"events":[{"id":"vault.create","payload":{"path":"notes","kind":"folder","operation":"created"}},{"id":"vault.create","payload":{"path":"notes/plan.md","kind":"file","revision":"9f2c…","operation":"created","bytes":18}}],"warnings":[]}
```

Failures have `ok:false` and `error:{code,message,hint?,retryable?,details?}`. Agents must inspect both the exit code and `ok`. Exit statuses: 0 success, 1 runtime/I/O/plugin or Claude failure, 2 invalid input or conflict, 3 missing file or project, 4 workspace writer busy, 5 generated UI/data-source drift, 130/143 interrupted Claude command. Every built-in code, with its exit status, `hint` (the next step) and `retryable` flag, is listed in the [error catalog](errors.md) and at `schema` `data.errors`. Edit and guarded-write failures carry recovery details: `NO_MATCH` and `AMBIGUOUS_EDIT` report match counts and lines, and `CONFLICT` reports `details.currentRevision`; see [recovering edits and guarded writes](errors.md#recovering-edits-and-guarded-writes). Unexpected parser/I/O errors use `OPERATION_FAILED`. `WORKSPACE_BUSY` details describe the lock holder; see the [write contract](#write-contract). Invalid `list --kind` values and flags that do not apply to the selected action (for example, `skills list --out skills` or `project list --kind domain`) fail with `INVALID_ARGUMENT` instead of being ignored. Commands are never retried automatically; only individual rename and delete calls retry briefly on transient file-locking errors (see the write contract).

`context` identifies the executed scope, rather than just the saved selection: `workspaceRoot` is the environment root, `root` is the root used for this command, and `project` is the selected project metadata or `null` for workspace scope. Check it before interpreting relative paths in changes or events. `project current` reports the saved selection in `data.project`; workspace commands can have `context.project:null` while a project is open. Version output and failures before scope resolution may have no context.

A listener warning does not make a committed write fail. Check the original `error`, result details and committed `vault.*` events before retrying after a warning or failure: activation, execution or result serialization can fail after earlier work changed state. Reread affected files and their revisions rather than assuming failure rolled everything back. Plugin commands must follow the same output discipline and return JSON-serializable data. The envelope schema is versioned by `schema.data.apiVersion` (currently 1).

`events` in the envelope is selected by `--events` or `settings.events`, with the flag taking precedence:

| Level | Envelope `events` |
| --- | --- |
| `changes` (default) | Only committed `vault.*` records: `vault.create`, `vault.modify`, `vault.delete` and `vault.rename`, for files and folders. Reads, dry runs and failures before a commit therefore return `[]` |
| `all` | The invocation history: `command.*`, `operation.*`, `claude.*` and `plugin.*` lifecycle phases, `workspace.*` analogues (`file-open`, `quick-preview`, `layout-ready`, `quit`, `project-change`), `vault.*` commits, `metadataCache.*` records that follow commits once the metadata cache is loaded in the invocation, and custom plugin events |
| `none` | Always `[]` |

The level shapes only the serialized response. Listener delivery, `replay` and the bounded history that plugins observe are unchanged. Use `--events all` to correlate lifecycle phases. In that full history, started and terminal `command.*`, `operation.*` and `claude.*` phases share an invocation-local `operationId`; operation `root` and Claude `cwd` identify their scope. Dry runs emit phase records and one `workspace.quick-preview` per planned file, but no `vault.*` or `metadataCache.*` records. Direct repository calls and arbitrary plugin code are outside workspace phase coverage. Event payloads summarize failures with codes and status, preserving detailed errors in the response. History retains at most 1,000 records from this invocation, with a warning when later live notifications are omitted. See [host events and replay](plugins.md#host-events-and-correlation).

## Commands

| Command | Arguments/options | Behavior |
| --- | --- | --- |
| `help` | `[command]` | The catalog, or one command's description, usage, described options and arguments, annotations (scope, discovery, mutating, readOnlyHint, actions) and error codes; see [command metadata](plugins.md#command-metadata) |
| `schema` | none | Machine-readable catalog: every command with a JSON Schema 2020-12 `inputSchema`, annotations and error codes; generator and skill IDs; built-in and plugin error codes |
| `config` | none | Effective validated configuration and selected paths, with plugin config sections in `config.plugins.settings` and their schemas in `sections` |
| `templates` | `[list / inspect <template.md> / install [workflow]]` | Discover template inputs or install missing editable workflow templates |
| `formats` | none | Native extension inventory and processing limits |
| `list` | `[--kind markdown / canvas / base / image / audio / video / pdf / text / attachment] [--path glob] [--limit count] [--cursor token]` | Sorted files and kinds; ignores symlinks, `.git`, `node_modules` and internal temporary files. See [path globs and paging](#path-globs-and-paging) |
| `read` | `<path> [--parts body]` | SHA-256 revision, byte count, parsed document, UTF-8 text or base64 bytes; `--parts body` adds the Markdown body |
| `validate` | `<path>` | Structural document check; text files are checked as UTF-8 (`utf8`); attachments are marked `opaque-bytes` |
| `create` | `<path> [--content text / --from path / --stdin] [--encoding base64]` | New file only; Markdown/Canvas/Base/text can use default empty documents |
| `write` | `<path> (--content text / --from path / --stdin) [--encoding base64] [--if-match hash]` | Create or replace; existing files require exact hash |
| `edit` | `<note.md or text file> --if-match hash (--append --content text / --find text --replace text)` | Append or replace exactly one literal match in Markdown or UTF-8 text; no match fails with `NO_MATCH`, and multiple matches, including overlapping matches, fail with `AMBIGUOUS_EDIT` |
| `properties` | `<note.md> --set JSON --if-match hash` | Merge top-level frontmatter properties; `null` stores YAML null |
| `patch` | `<file.canvas/base> --pointer /path --value JSON --if-match hash` | Set a key or existing array element; `-` appends |
| `move` | `<from> <to> --if-match hash [--no-update-links]` | Move or rename a file or folder and rewrite every link to it in the same batch; see [moving and deleting](#moving-and-deleting) |
| `rename` | `<path> <new-name> --if-match hash [--no-update-links]` | `move` within the same folder; a file keeps its extension when `<new-name>` omits it |
| `delete` | `<path> --if-match hash [--recursive] [--permanent] [--allow-broken-links]` | Move a file, or a folder with `--recursive`, to `.trash/`; `--permanent` removes it. Refuses with `HAS_BACKLINKS` while other files link into it |
| `make` | `[generator PascalCaseName] [--out directory]` | List or run generators; defaults to `src/domain` in the active scope, `src/presentation/forms` for `form`, or workspace `bin/plugins` for `plugin` (`--out` is not allowed for plugins); dry-run includes generated text. Each generator accepts only its declared options; see [generators](plugins.md#generators) |
| `make form` | `<PascalCaseName> [--out directory]` | Create a typed form definition and unit test in the open Forge project; default `src/presentation/forms`, with real HTML preview from the same definition |
| `make document` | `<Title> --template <template.md> [--out directory] [--values JSON / --values-from path] [--date ISO]` | Render Markdown/frontmatter template to a new `<Title>.md` in active-scope `notes`, or `--out` |
| `components` | `init / list / inspect <id> / validate / create <id> / import / export [--library directory]` | Manage workspace Markdown component definitions; `create` accepts `--tag`, import accepts `--from`, export accepts `--out` |
| `interactions` | `list / init / inspect <id> / validate / create <id> / import / export [--library directory]` | Manage workspace event/action definitions; create accepts `--event`, import/export accept `--from`/`--out`; see [interactions](interactions.md) |
| `make ui` | `<id> [--framework target] [--library directory] [--interactions-library directory] [--project id] [--out directory] [--stories] [--stories-out directory] [--revisions-from file.json] [--plan] [--plan-out file.json] [--check]` | Generate deterministic UI boilerplate and optionally Storybook stories from a component and its references |
| `make stories` | `<id> [--framework target] [--library directory] [--interactions-library directory] [--project id] [--out directory] [--stories-out directory] [--revisions-from file.json] [--plan] [--plan-out file.json] [--check]` | Generate stories referring to existing UI at `--out` or its default; stories go to `--stories-out` or its default |
| `data-sources` | `list / init / inspect <id> / validate / create <id> / import / export [--library directory]` | Manage workspace REST/local JSON source definitions; create accepts `--kind`, import/export accept `--from`/`--out` |
| `make data-source` | `<id> [--library directory] [--project id] [--out directory] [--test-data-out directory] [--revisions-from file.json / --plan / --plan-out file.json / --check]` | Generate TypeScript adapters and deterministic test data with guarded regeneration and drift checks; see [data-source reference](data-sources.md) |
| `workflows` | `list / sync [--check] [--dry-run]` | Workspace scope. Discover each managed project's authored CI under `src/infrastructure/workflows/<concern>/` and generate prefixed, path-scoped `.github/workflows` entrypoints; `--check` exits 5 with `WORKFLOW_DRIFT`; see [workflows](workflows.md) |
| `events` | none | Registered event IDs, descriptions and invocation delivery/replay semantics |
| `plugins` | none | Core and user plugins with `core`, `state` (`enabled`, `disabled`, `skipped`) and contributions; see [core and user plugins](plugins.md#core-and-user-plugins) |
| `claude` | `capabilities / agents / hooks / plugins / marketplaces / runtime` | Native Claude Code configuration and installed CLI lifecycle; see the [Claude command reference](claude.md) |
| `bases` | `list / inspect <path.base> / query <path.base> [--view name] [--context note.md] [--limit count] / capabilities` | Evaluate a saved view and return matching files in the active vault without Obsidian; see [Bases queries](bases.md). Contributed by the `bases` core plugin |
| `skills` | `[list / show <id> / install] [--out directory]` | List/read skills or create `<out>/<id>/SKILL.md`; default `.agents/skills` in active scope. Contributed by the `skills` core plugin |
| `setup` | none | Initialize missing app/config, skills, example template and lean AGENTS.md; report existing destinations as skipped |
| `project` | `list / inspect [id] / create <kebab-name>` | Discover or scaffold workspace projects; inspect without an ID uses the selected project |
| `project open` | `<id>` | Persist a managed project as the active scope |
| `project current` | none | Report the selected project, or `null` |
| `project close` | none | Clear selection and restore workspace scope |
| `project component` | `[id] <PascalName> [--kind domain / application]` | Add to an explicit project, or the selected project when the ID is omitted |

`--from` reads a file within the selected root and copies bytes by default. `--stdin` reads bytes until EOF; an interactive TTY fails immediately. `--content` treats input as UTF-8. `--encoding base64` decodes the chosen input before writing. These three sources are mutually exclusive. The CLI retains files in memory, so use plugins for streaming very large media.

`read` returns Markdown as `document:{kind,content,properties}`, Canvas/Bases as `{kind,data}`, text files as `{kind:"text",content}`, and attachments as `{kind,encoding:"base64",content}`. `--parts` takes a comma-separated list of optional parts; `body` adds the Markdown text after frontmatter as `document.body`. It applies only to Markdown, and unknown parts fail with `INVALID_ARGUMENT`. A file with a [text extension](formats.md#utf-8-text) whose bytes are not valid UTF-8 reads as `{kind:"attachment",encoding:"base64",content}`. To export an attachment with only Node available:

```sh
node bin/forge.js read assets/diagram.png --json | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const r=JSON.parse(s);if(!r.ok)process.exit(1);process.stdout.write(Buffer.from(r.data.document.content,"base64"));})' > exported.png
```

## Path globs and paging

`list` filters with `--path <glob>`, matched against the whole root-relative path, case-sensitively: `*` matches within one path segment, `?` one character other than `/`, `**` as a whole segment any number of segments, `[abc]`, `[a-z]` and `[!abc]` one character of a class, `{md,canvas}` either alternative, and `\` escapes the next character. A leading `./` is ignored. `notes/*.md` lists only files directly in `notes`, `notes/**` everything below it and `**/*.md` Markdown files at any depth; quote globs for your shell. An unclosed `{` or a trailing `\` fails with `INVALID_ARGUMENT`.

`list` pages with `--limit <count>` (a positive integer) and `--cursor <token>`. A truncated page returns `nextCursor`; pass it back with the same command, filters and pattern to continue after the last returned item. Without `nextCursor` the result is complete. Results keep their stable path order, and a cursor resumes after a position rather than an index, so files added or removed between calls neither repeat nor skip later items. A cursor is opaque and bound to its query: a malformed cursor, or one used with different filters, fails with `INVALID_ARGUMENT`. `list` returns every file when `--limit` is omitted.

## Dry-run diffs

Dry-run `create`, `write`, `edit`, `properties`, `patch`, `move` and `rename` add `diff` to each entry of `data.changes`. For Markdown, Canvas, Bases and text files with valid UTF-8 content, it is a unified diff with three context lines, `--- a/<path>` and `+++ b/<path>` headers (`--- /dev/null` for a new file) and paths relative to `context.root`. Unchanged content yields `""`. Binary or undecodable content has `diff: null`; compare `bytes` and `revision` instead. Real writes return no `diff`. The text applies with standard tools such as `git apply` from the command root:

```sh
node bin/forge.js edit notes/plan.md --find 'Draft' --replace 'Ready' --if-match YOUR_REVISION --dry-run --json
```

```json
{"dryRun":true,"changes":[{"path":"notes/plan.md","revision":"4be1…","operation":"updated","bytes":42,"diff":"--- a/notes/plan.md\n+++ b/notes/plan.md\n@@ -1,3 +1,3 @@\n # Plan\n-Draft\n+Ready\n Next steps\n"}]}
```

A dry run checks `--if-match` exactly like the real write: a stale or missing revision for an existing file fails with `CONFLICT` (exit 2), with the same `details.currentRevision`, and nothing is written.

## Canvas and Bases

```sh
node bin/forge.js create architecture.canvas
node bin/forge.js read architecture.canvas --json
node bin/forge.js patch architecture.canvas --pointer /nodes/- --value '{"id":"domain","type":"text","x":0,"y":0,"width":320,"height":180,"text":"Domain"}' --if-match YOUR_REVISION
node bin/forge.js create tasks.base
node bin/forge.js read tasks.base --json
node bin/forge.js patch tasks.base --pointer /views/0/name --value '"Engineering tasks"' --if-match YOUR_REVISION
node bin/forge.js bases query tasks.base --view 'Engineering tasks'
```

JSON Pointer uses `~0` for `~` and `~1` for `/`. Parent containers must exist. Array indices must exist except `-` append. Prototype keys are forbidden. To remove a key/node/edge, or make a coordinated graph change, read the document, modify it, and use `write --stdin --if-match <revision>` with the complete result. Use `move`, `rename` and `delete` to restructure files; they keep Canvas `file` nodes pointing at moved notes.

## Moving and deleting

`move`, `rename` and `delete` are the agent's counterparts of Obsidian's "Rename", "Move file to…" and "Delete" with automatic link updates. Each runs as one guarded batch under the writer lock.

```sh
node bin/forge.js move notes/Plan.md specs/Roadmap.md --dry-run      # diffs of every rewritten file and data.revision
node bin/forge.js move notes/Plan.md specs/Roadmap.md --if-match YOUR_REVISION
node bin/forge.js rename specs/Roadmap.md "Product roadmap" --if-match YOUR_REVISION
node bin/forge.js delete scratch/Idea.md --if-match YOUR_REVISION
node bin/forge.js delete scratch --recursive --dry-run               # every affected file, links into it and the folder revision
```

`--if-match` guards the moved or deleted path: a file's revision from `read`, or for a folder its folder revision, the SHA-256 of each contained file's folder-relative path and revision. Real runs require it. A dry run may omit it and reports the current revision as `data.revision`, together with every planned change. A folder revision changes whenever a file inside it is added, removed or edited. Folders containing a `.git` repository are refused with `PROTECTED_PATH`.

`move <from> <to>` refuses an existing destination with `DESTINATION_EXISTS` and never overwrites one, creates missing destination folders, and allows a change of letter case only (`Plan.md` to `plan.md`), also on case-insensitive filesystems. `rename <path> <new-name>` moves within the same folder; `<new-name>` has no `/`, and a file keeps its extension when the name omits it. Unless `--no-update-links` is given, the metadata cache plans every link update, and the batch writes each changed file with the revision it was planned from. A reference is rewritten only when its unchanged text would stop resolving to the moved file (or to the same file it named before), so links that still resolve, such as a bare `[[Name]]` after a move to another folder, keep their text. Rewriting covers:

| Reference | Rewrite |
| --- | --- |
| Wikilinks and embeds | The link path changes; `!`, `#Heading`, `#^block` and `\|display` text stay. A bare name stays the shortest unambiguous name (Obsidian's `fileToLinktext`), a path stays a full vault path, and `.md` is spelled only if it was |
| Markdown links and images, reference definitions, HTML `href`/`src` | Relative paths are recomputed from the source's (new) folder; vault-absolute paths stay absolute. Fragments, titles, angle brackets and percent-encoding are kept |
| Frontmatter links | Quoted wikilinks and Markdown links in property values, including list items, are replaced in the YAML text, preserving its style |
| Canvas `file` nodes | Every node naming a moved file gets its new path, because Obsidian opens nodes by exact path; `subpath` and layout are untouched |
| Links inside moved notes | Relative links are recomputed from their new folder |

Aliases are never edited, and links resolved through an alias keep resolving. Links that a move would make ambiguous elsewhere (another `[[Name]]` now matching two files) are rewritten to the full path of the file they named. Frontmatter links whose YAML spelling differs from their link text (for example with escapes) are listed in `data.links.unrewritten` instead of being guessed. Forge does not read `.obsidian/app.json` link preferences; the rules above follow Obsidian's default "shortest path when possible" format. Rewriting `.base` expressions is out of scope.

The result is `{dryRun, from, to, kind, revision, renames, changes, links:{updated, files, unrewritten}}`. A committed move publishes `vault.create` for new destination folders, `vault.rename` for the folder (if any) and then for each moved descendant folder and file in path order, `vault.modify` for every rewritten file, and, because these commands load the metadata cache, `metadataCache.changed` and `metadataCache.resolve` for the rewritten and re-resolved files followed by `metadataCache.resolved`. As in Obsidian, a rename alone publishes no `metadataCache.changed` or `metadataCache.deleted` for the moved file.

`delete <path>` moves the file, or with `--recursive` the folder, to `.trash/<path>` in the current scope, Obsidian's "Move to Obsidian trash". If that name is taken it appends ` 1`, ` 2`… before the extension. `--permanent` removes it instead; files already in `.trash` can only be removed with `--permanent`. Before either, it checks links: when files outside the deleted path link into it, it fails with `HAS_BACKLINKS` and `details.backlinks`, unless `--allow-broken-links` is given; the result then reports them in `brokenLinks`. The scope's `.obsidian` and `.forge`, and `bin` at workspace scope, are protected. The result is `{dryRun, path, kind, revision, permanent, trashPath, deleted, brokenLinks}`. A committed delete publishes `vault.delete` for each deleted file, then each folder (child before parent), followed by `metadataCache.deleted` records; a trashed file is retained under `.trash`, which the metadata cache and `vault.*` records do not cover.

## Write contract

File paths are POSIX paths relative to the active project, or the workspace when no project is selected. `--root` selects the workspace; `project open` selects a managed project within it. Shared templates/plugins and project management remain workspace-scoped. `setup` always installs into the workspace. Absolute paths, traversal, backslashes, control characters, symlink components and Git internals are rejected. The root must already exist. Existing files require a matching content hash even when the proposed bytes are identical. TypeScript scaffold names are PascalCase; UI generators select component IDs from the library. All output paths are checked through the same repository port.

The host filesystem still determines which filenames work. For workspaces shared across operating systems, avoid Windows reserved names such as `CON`, trailing periods/spaces, and paths differing only in letter case. Portable execution does not make every filename portable. Automated CI runs the full gate on Ubuntu, Windows and macOS with Node 22.12 and 24. On case-insensitive file systems (the macOS and Windows defaults), a path differing only in letter case resolves to the existing file, so writing it without that file's `--if-match` revision fails with `CONFLICT` instead of overwriting it. Revisions hash raw bytes: CRLF and LF versions of the same text have different revisions, and `edit` preserves the line endings it does not replace.

A real batch acquires `.agent-cli.lock` and checks every step before changing anything. A batch holds renames, writes and removals. Renames apply first: each source must still have its expected revision, and an existing destination fails with `DESTINATION_EXISTS`. Writes follow and see the renamed files, so a write to a moved file is guarded by the revision it had before the move. Removals apply last. Each write replaces its file through a same-directory temporary file and rename; a removal first renames its file or folder to a reserved `.agent-cli-tmp-*` name and deletes it once the batch is durable. A case-only rename passes through such a reserved name. Reported runtime failures trigger a best-effort rollback of every applied step in reverse order. Existing file permissions are retained. All steps must succeed before `vault.*` events are emitted: first one `vault.create` with `kind: "folder"` per newly created directory (parent before child, in the order the batch created them), then one `vault.rename` per moved folder or file, then one record per written or removed file in batch order, then one `vault.delete` with `kind: "folder"` per removed folder (child before parent). Dry runs take no lock and create nothing; their results describe the current snapshot, not a reservation.

Durability: every temporary file is written and its data fsynced (up to eight concurrently) before the first rename, so a staging failure such as a full disk changes no target file. After all renames, every directory whose entries changed (renamed files, deletions and newly created directories) is fsynced once, before the command returns and before `vault.*` events are emitted. Rollback restores, deletions and directory removals are fsynced the same way. A directory fsync failure fails the batch and triggers rollback. Platforms that cannot fsync a directory, such as Windows (`EISDIR`/`EPERM`/`EINVAL`), skip that step. On every platform, rename, delete and lock-removal calls that fail with `EPERM`, `EACCES` or `EBUSY` (typically antivirus, indexers or editors holding a file on Windows) are retried with backoff of 10–320 ms, at most about 0.6 s in total, before the failure is reported. Each file replacement is atomic and durable once the command succeeds, but a multi-file batch is still not a crash-atomic transaction: a crash or power loss part-way may leave some files written, a temporary `.agent-cli-tmp-*` file or the lock.

The lock records its holder as JSON: `{pid, hostname, startedAt, command?, operationId?, forgeVersion, pidNamespace?, bootId?, token}`. `command` and `operationId` match the `command.started` event of the invocation that holds it. On Linux, `pidNamespace` (the `/proc/self/ns/pid` link) and `bootId` say where the pid is meaningful; other platforms omit them. The writer writes and fsyncs the record to a reserved `.agent-cli-tmp-lock-*` file and hard-links it to `.agent-cli.lock`, so the lock never appears without its holder. On filesystems without hard links it falls back to an exclusive create followed by the write. Creation retries transient `EPERM`, `EACCES` and `EBUSY` failures and then reports a lock that stays denied (for example one pending deletion on Windows) as `WORKSPACE_BUSY`. `token` is a random value private to the writer: a writer removes the lock only while it still carries its own token, and otherwise leaves it in place and returns a warning. The lock coordinates this CLI's writers. It does not coordinate Obsidian, editors, external writers, hostile concurrent path replacements or power loss. A write that finds the lock fails with `WORKSPACE_BUSY` (exit 4) and these `error.details`:

| Field | Meaning |
| --- | --- |
| `lock` | The recorded holder without its `token`, or `null` when the lock is empty, unreadable, still being written or from an older version |
| `stale` | `"active"`: a process with the recorded pid runs in this host's pid namespace, or `lock` is `null` and the file changed within the last 5 seconds (its holder may still be writing it). `"likely"`: the lock was written on this host in the same pid namespace and boot, and that pid no longer runs or is the inspecting process itself (as after a container restart with a fixed pid). `"unknown"`: the lock was written on another host, in another pid namespace (another container) or before a reboot, or `lock` is `null` and older |

Forge never removes a lock automatically, because a pid can be reused and another host or container cannot be checked. To recover from `"likely"`, inspect the holder's changes (for example with `git status`), confirm no Forge writer is running, delete `.agent-cli.lock` and retry. With `"active"`, wait and retry; if that process is not a Forge writer (a reused pid), handle it like `"likely"`. With `"unknown"`, check the recorded pid on the recorded host yourself, or confirm no writer uses the workspace, before deleting the lock. A `ROLLBACK_FAILED` result identifies files or directories requiring inspection. Do not use this local-project tool as a multi-tenant filesystem sandbox.

## Component libraries and UI generation

Run `components init --dry-run` before creating the starter library, then inspect definitions with `components list` and `components inspect <id>`. Add Markdown files to the configured library, or use `components create <id> --tag <html-tag>` as a starting point. `components validate` checks the complete library before generation. Supported targets are `html`, `htmx`, `vanilla`, `vue`, `svelte`, `react` and `angular`.

Component management and library/import/export paths are workspace-scoped. Generated UI and stories use the open project, or workspace scope if none is open. `make ui/stories --project <id>` selects a project for that invocation only. Output overrides are relative to that selected scope; verify `context.root` in the response.

`components import` reads from `paths.componentImports` unless `--from` is supplied; `components export` writes to `paths.componentExports` unless `--out` is supplied. Both transfer Markdown definitions through workspace write planning. Component and interaction transfer directories must be disjoint: neither may equal or contain the other. UI/story writes are create-only unless `--revisions-from <file.json>` supplies current SHA-256 revisions for existing destinations; import/export writes are always create-only. The JSON revision map uses workspace-relative generated output paths, while the map file is read in the selected output scope. Missing, stale or unrelated revisions fail; see the regeneration example in [UI components](ui-components.md). `components init` preserves definitions with IDs already present and adds missing starter definitions. To maintain a workspace definition through generic file commands, close the active project, then use `read` followed by `properties`, `edit` or `write` with its revision. See [UI components](ui-components.md) for the schema, examples, dependencies and Storybook extension contract.

### UI planning and drift checks

`make ui/stories <id> --plan` returns a read-only comparison with `matches`, `revisions`, and `outputs`. Each output has `path`, `status` (`missing`, `unchanged` or `changed`), proposed `content`, and current `revision`/`currentContent` when present. `--plan-out <file.json>` implies planning and creates a revision-map file in the selected project/workspace scope; generated outputs remain untouched. It follows ordinary collision and dry-run rules.

`--check` compares the same output set without writing. Matching output succeeds with `matches:true`; missing or changed output exits 5 with `UI_DRIFT` and `error.details.outputs` describing paths/statuses. Use it in CI to detect drift. It does not compile components or run Storybook. `--check` cannot combine with `--plan`, `--plan-out` or `--revisions-from`; plan modes cannot combine with `--revisions-from`. See [planning and regeneration](../how-to/manage-components.md).

`components list` returns a compact catalog; use `components inspect <id>` for the definition and source revision/byte information. An empty `components validate` result is valid but identifies the empty library and points to initialization; generation still requires a selected definition.

## Interaction libraries

`interactions init` supplies editable event/action starters; `interactions inspect <id>` includes source revision and byte count. `interactions validate` checks definition syntax and duplicate IDs. `components validate` also checks each attached interaction against the component's state and element type. Components and `make ui/stories` accept `--interactions-library` to override the workspace behavior library. Changing behavior definitions participates in the same UI planning, revision and drift checks. See [interaction contracts](interactions.md) and the [interactive form tutorial](../tutorials/interactive-form.md).
