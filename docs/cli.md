# Command reference and agent protocol

Run `node bin/app <command>`. Global options may appear before or after the command: `--root <directory>`, `--json`, `--dry-run`, `--plugins <relative-manifest.json>`, `--help`, `--version`. Use `--key=value` for values beginning with `--`. Use `--` to stop option parsing. Unknown or repeated options are errors. Short option aliases are not supported.

## Output and errors

Every built-in invocation emits one JSON document on stdout, with no prompts or ANSI sequences:

```json
{"ok":true,"data":{"dryRun":false,"changes":[]},"events":[],"warnings":[]}
```

Failures have `ok:false` and `error:{code,message}`. Agents must inspect both the exit code and `ok`. Codes: 0 success, 1 runtime/I/O/plugin error, 2 invalid input or conflict, 3 missing file, 4 workspace writer busy. Errors include `CONFLICT`, `INVALID_PATH`, `UNSAFE_PATH`, `INVALID_CANVAS`, `INVALID_BASE`, `INVALID_YAML`, `UNKNOWN_COMMAND`, `UNKNOWN_OPTION`, `AMBIGUOUS_EDIT`, `WORKSPACE_BUSY`, and `ROLLBACK_FAILED`. Unexpected parser/I/O errors use `OPERATION_FAILED`. No automatic retry occurs.

A listener warning does not make a committed write fail. Check `events` and read the result before retrying anything after a warning. Plugin commands must follow the same output discipline and return JSON-serializable data. The envelope schema is versioned by `schema.data.apiVersion` (currently 1).

## Commands

| Command | Arguments/options | Behavior |
| --- | --- | --- |
| `help` | `[command]` | Descriptions, options, usage |
| `schema` | none | Machine-readable catalog, generator and skill IDs |
| `formats` | none | Native extension inventory and processing limits |
| `list` | `[--kind markdown]` | Sorted files and kinds; ignores symlinks, `.git`, `node_modules` and internal temporary files |
| `read` | `<path>` | SHA-256 revision, byte count, parsed document or base64 bytes |
| `validate` | `<path>` | Structural document check; attachments are marked `opaque-bytes` |
| `create` | `<path> [--content text / --from path / --stdin] [--encoding base64]` | New file only; Markdown/Canvas/Base can use default empty documents |
| `write` | `<path> (--content text / --from path / --stdin) [--encoding base64] [--if-match hash]` | Create or replace; existing files require exact hash |
| `edit` | `<note.md> --if-match hash (--append --content text / --find text --replace text)` | Append or replace exactly one literal match; ambiguous matches fail |
| `properties` | `<note.md> --set JSON --if-match hash` | Merge top-level frontmatter properties; `null` stores YAML null |
| `patch` | `<file.canvas/base> --pointer /path --value JSON --if-match hash` | Set a key or existing array element; `-` appends |
| `make` | `[generator PascalCaseName] [--out directory]` | List or run generators; dry-run includes generated text |
| `events` | none | Registered events and delivery semantics |
| `plugins` | none | Manifests loaded using the explicit global `--plugins` option |
| `skills` | `[list / show <id> / install] [--out directory]` | List/read skills or create `<out>/<id>/SKILL.md`; default `.agents/skills` |
| `init` | none | Create empty plugin manifest and bundled process skills |

`--from` reads a file within the selected root and copies bytes by default. `--stdin` reads bytes until EOF; an interactive TTY fails immediately. `--content` treats input as UTF-8. `--encoding base64` decodes the chosen input before writing. These three sources are mutually exclusive. The CLI retains files in memory, so use plugins for streaming very large media.

`read` returns Markdown as `document:{kind,content,properties,body}`, Canvas/Bases as `{kind,data}`, and attachments as `{kind,encoding:"base64",content}`. To export an attachment with only Node available:

```sh
node bin/app read assets/diagram.png --json | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const r=JSON.parse(s);if(!r.ok)process.exit(1);process.stdout.write(Buffer.from(r.data.document.content,"base64"));})' > exported.png
```

## Canvas and Bases

```sh
node bin/app create architecture.canvas
node bin/app read architecture.canvas --json
node bin/app patch architecture.canvas --pointer /nodes/- --value '{"id":"domain","type":"text","x":0,"y":0,"width":320,"height":180,"text":"Domain"}' --if-match YOUR_REVISION
node bin/app create tasks.base
node bin/app read tasks.base --json
node bin/app patch tasks.base --pointer /views/0/name --value '"Engineering tasks"' --if-match YOUR_REVISION
```

JSON Pointer uses `~0` for `~` and `~1` for `/`. Parent containers must exist. Array indices must exist except `-` append. Prototype keys are forbidden. To remove a key/node/edge, or make a coordinated graph change, read the document, modify it, and use `write --stdin --if-match <revision>` with the complete result. There is no filesystem delete or rename command in version 0.1.

## Write contract

Paths are project-relative POSIX paths. Absolute paths, traversal, backslashes, control characters, symlink components and Git internals are rejected. The root must already exist. Existing files require a matching content hash even when the proposed bytes are identical. Generator names are PascalCase and their output paths are checked through the same repository port.

A real batch acquires `.agent-cli.lock`, validates every destination, then replaces each file using a same-directory temporary file and rename. Reported runtime write failures trigger a best-effort rollback. Existing file permissions are retained. All planned writes must succeed before file events are emitted. Dry runs take no lock and create nothing; their results describe the current snapshot, not a reservation.

The lock coordinates this CLI's writers. It does not coordinate Obsidian, editors, external writers, hostile concurrent path replacements or power loss. The batch is not a crash-atomic filesystem transaction; an interruption may leave partial work or the lock. After an interrupted process, inspect changes and confirm no CLI writer is active before removing `.agent-cli.lock`. A `ROLLBACK_FAILED` result identifies files requiring inspection. Do not use this local-project tool as a multi-tenant filesystem sandbox.
