# Command reference and agent protocol

[Documentation](../index.md) · Reference

Run `node bin/app.js [routing options] <command> [options]`. Routing options `--root <directory>` and `--no-plugins` must precede the command because they select the workspace and loaded command catalog. For example, `node bin/app.js --root /path/to/workspace --no-plugins setup --dry-run`.

Commander accepts `--json`, `--no-json`, `--dry-run`, `--no-dry-run`, `--lang en|de` and `--help` (`-h`) before or after the command. Use `node bin/app.js --version` (`-V`) to inspect the executable version. Prefer `--key=value` for literal values beginning with `--`; use `--` to stop option parsing. Unknown, repeated or misplaced routing options are errors. Negated boolean flags override configuration defaults. `--no-plugins` disables configured plugins for one invocation. See [configuration precedence](configuration.md) and [language selection](language.md).

## Output and errors

Every built-in invocation emits one JSON document on stdout, with no prompts or ANSI sequences:

```json
{"ok":true,"data":{"dryRun":false,"changes":[]},"context":{"workspaceRoot":"/workspace","root":"/workspace","project":null},"events":[],"warnings":[]}
```

Failures have `ok:false` and `error:{code,message}` with optional structured `error.details`. Agents must inspect both the exit code and `ok`. Codes: 0 success, 1 runtime/I/O/plugin error, 2 invalid input or conflict, 3 missing file, 4 workspace writer busy, 5 generated UI/data-source drift. Errors include `INVALID_ARGUMENT`, `CONFLICT`, `INVALID_PATH`, `UNSAFE_PATH`, `INVALID_CANVAS`, `INVALID_BASE`, `INVALID_YAML`, `UNKNOWN_COMMAND`, `UNKNOWN_OPTION`, `AMBIGUOUS_EDIT`, `WORKSPACE_BUSY`, and `ROLLBACK_FAILED`. Unexpected parser/I/O errors use `OPERATION_FAILED`. Invalid `list --kind` values and flags that do not apply to the selected action (for example, `skills list --out skills` or `project list --kind domain`) fail with `INVALID_ARGUMENT` instead of being ignored. No automatic retry occurs.

`context` identifies the executed scope, rather than just the saved selection: `workspaceRoot` is the environment root, `root` is the root used for this command, and `project` is the selected project metadata or `null` for workspace scope. Check it before interpreting relative paths in changes or events. `project current` reports the saved selection in `data.project`; workspace commands can have `context.project:null` while a project is open. Version output and failures before scope resolution may have no context.

A listener warning does not make a committed write fail. Check `events` and read the result before retrying anything after a warning. Plugin commands must follow the same output discipline and return JSON-serializable data. The envelope schema is versioned by `schema.data.apiVersion` (currently 1).

## Commands

| Command | Arguments/options | Behavior |
| --- | --- | --- |
| `help` | `[command]` | Descriptions, options, usage |
| `schema` | none | Machine-readable catalog, generator and skill IDs |
| `config` | none | Effective validated configuration and selected paths |
| `templates` | `[list / inspect <template.md> / install [workflow]]` | Discover template inputs or install missing editable workflow templates |
| `formats` | none | Native extension inventory and processing limits |
| `list` | `[--kind markdown / canvas / base / image / audio / video / pdf / attachment]` | Sorted files and kinds; ignores symlinks, `.git`, `node_modules` and internal temporary files |
| `read` | `<path>` | SHA-256 revision, byte count, parsed document or base64 bytes |
| `validate` | `<path>` | Structural document check; attachments are marked `opaque-bytes` |
| `create` | `<path> [--content text / --from path / --stdin] [--encoding base64]` | New file only; Markdown/Canvas/Base can use default empty documents |
| `write` | `<path> (--content text / --from path / --stdin) [--encoding base64] [--if-match hash]` | Create or replace; existing files require exact hash |
| `edit` | `<note.md> --if-match hash (--append --content text / --find text --replace text)` | Append or replace exactly one literal match; multiple matches, including overlapping matches, fail |
| `properties` | `<note.md> --set JSON --if-match hash` | Merge top-level frontmatter properties; `null` stores YAML null |
| `patch` | `<file.canvas/base> --pointer /path --value JSON --if-match hash` | Set a key or existing array element; `-` appends |
| `make` | `[generator PascalCaseName] [--out directory]` | List or run generators; defaults to `src/domain` in the active scope, `src/presentation/forms` for `form`, or workspace `bin/plugins` for `plugin` (`--out` is not allowed for plugins); dry-run includes generated text |
| `make form` | `<PascalCaseName> [--out directory]` | Create a typed form definition and unit test in the open Forge project; default `src/presentation/forms`, with real HTML preview from the same definition |
| `make document` | `<Title> --template <template.md> [--out directory] [--values JSON / --values-from path] [--date ISO]` | Render Markdown/frontmatter template to a new `<Title>.md` in active-scope `notes`, or `--out` |
| `components` | `init / list / inspect <id> / validate / create <id> / import / export [--library directory]` | Manage workspace Markdown component definitions; `create` accepts `--tag`, import accepts `--from`, export accepts `--out` |
| `interactions` | `list / init / inspect <id> / validate / create <id> / import / export [--library directory]` | Manage workspace event/action definitions; create accepts `--event`, import/export accept `--from`/`--out`; see [interactions](interactions.md) |
| `make ui` | `<id> [--framework target] [--library directory] [--interactions-library directory] [--project id] [--out directory] [--stories] [--stories-out directory] [--revisions-from file.json] [--plan] [--plan-out file.json] [--check]` | Generate deterministic UI boilerplate and optionally Storybook stories from a component and its references |
| `make stories` | `<id> [--framework target] [--library directory] [--interactions-library directory] [--project id] [--out directory] [--stories-out directory] [--revisions-from file.json] [--plan] [--plan-out file.json] [--check]` | Generate stories referring to existing UI at `--out` or its default; stories go to `--stories-out` or its default |
| `data-sources` | `list / init / inspect <id> / validate / create <id> / import / export [--library directory]` | Manage workspace REST/local JSON source definitions; create accepts `--kind`, import/export accept `--from`/`--out` |
| `make data-source` | `<id> [--library directory] [--project id] [--out directory] [--test-data-out directory] [--revisions-from file.json / --plan / --plan-out file.json / --check]` | Generate TypeScript adapters and deterministic test data with guarded regeneration and drift checks; see [data-source reference](data-sources.md) |
| `events` | none | Registered events and delivery semantics |
| `plugins` | none | Enabled manifests loaded from shared workspace `bin/plugins` |
| `skills` | `[list / show <id> / install] [--out directory]` | List/read skills or create `<out>/<id>/SKILL.md`; default `.agents/skills` in active scope |
| `setup` | none | Initialize missing app/config, skills, example template and lean AGENTS.md; report existing destinations as skipped |
| `project` | `list / inspect [id] / create <kebab-name>` | Discover or scaffold workspace projects; inspect without an ID uses the selected project |
| `project open` | `<id>` | Persist a managed project as the active scope |
| `project current` | none | Report the selected project, or `null` |
| `project close` | none | Clear selection and restore workspace scope |
| `project component` | `[id] <PascalName> [--kind domain / application]` | Add to an explicit project, or the selected project when the ID is omitted |

`--from` reads a file within the selected root and copies bytes by default. `--stdin` reads bytes until EOF; an interactive TTY fails immediately. `--content` treats input as UTF-8. `--encoding base64` decodes the chosen input before writing. These three sources are mutually exclusive. The CLI retains files in memory, so use plugins for streaming very large media.

`read` returns Markdown as `document:{kind,content,properties,body}`, Canvas/Bases as `{kind,data}`, and attachments as `{kind,encoding:"base64",content}`. To export an attachment with only Node available:

```sh
node bin/app.js read assets/diagram.png --json | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const r=JSON.parse(s);if(!r.ok)process.exit(1);process.stdout.write(Buffer.from(r.data.document.content,"base64"));})' > exported.png
```

## Canvas and Bases

```sh
node bin/app.js create architecture.canvas
node bin/app.js read architecture.canvas --json
node bin/app.js patch architecture.canvas --pointer /nodes/- --value '{"id":"domain","type":"text","x":0,"y":0,"width":320,"height":180,"text":"Domain"}' --if-match YOUR_REVISION
node bin/app.js create tasks.base
node bin/app.js read tasks.base --json
node bin/app.js patch tasks.base --pointer /views/0/name --value '"Engineering tasks"' --if-match YOUR_REVISION
```

JSON Pointer uses `~0` for `~` and `~1` for `/`. Parent containers must exist. Array indices must exist except `-` append. Prototype keys are forbidden. To remove a key/node/edge, or make a coordinated graph change, read the document, modify it, and use `write --stdin --if-match <revision>` with the complete result. There is no filesystem delete or rename command in version 0.1.

## Write contract

File paths are POSIX paths relative to the active project, or the workspace when no project is selected. `--root` selects the workspace; `project open` selects a managed project within it. Shared templates/plugins and project management remain workspace-scoped. `setup` always installs into the workspace. Absolute paths, traversal, backslashes, control characters, symlink components and Git internals are rejected. The root must already exist. Existing files require a matching content hash even when the proposed bytes are identical. TypeScript scaffold names are PascalCase; UI generators select component IDs from the library. All output paths are checked through the same repository port.

The host filesystem still determines which filenames work. For workspaces shared across operating systems, avoid Windows reserved names such as `CON`, trailing periods/spaces, and paths differing only in letter case. Portable execution does not make every filename portable. Automated CI currently runs on Ubuntu with Node 22.12 and 24; native Windows/macOS behavior is not covered by that matrix.

A real batch acquires `.agent-cli.lock`, validates every destination, then replaces each file using a same-directory temporary file and rename. Reported runtime write failures trigger a best-effort rollback. Existing file permissions are retained. All planned writes must succeed before file events are emitted. Dry runs take no lock and create nothing; their results describe the current snapshot, not a reservation.

The lock coordinates this CLI's writers. It does not coordinate Obsidian, editors, external writers, hostile concurrent path replacements or power loss. The batch is not a crash-atomic filesystem transaction; an interruption may leave partial work or the lock. After an interrupted process, inspect changes and confirm no CLI writer is active before removing `.agent-cli.lock`. A `ROLLBACK_FAILED` result identifies files requiring inspection. Do not use this local-project tool as a multi-tenant filesystem sandbox.

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
