# Webview projects and publication

[Documentation](../index.md) · Reference

The `webviews` core plugin provides publication tools and the `forge-webviews` skill. `project create <id> --type webview` uses the scaffolds plugin to create an independent Vue 3/Nuxt UI project. The core `server` remains a separate framework-independent service. See [prototype a webview](../how-to/prototype-webviews.md) for a complete workflow.

## Commands and scope

| Command | Contract |
| --- | --- |
| `project create <id> --type webview [--dry-run]` | Create a managed project under `paths.projects`, preserving the active selection. The default project type remains `library`. |
| `webview inspect` | Read the selected webview project's build and installed publication state, including its current folder revision. A missing build is reported as `built: false`. |
| `webview publish [--if-match <revision>] [--dry-run]` | Publish the project's already-built `dist/` into workspace `bin/webviews/<id>/`. First publication creates new output; changed installed output requires its current folder revision. Identical output is a no-op. |
| `webview publish --check` | Compare the build and installed assets without writing. Differences fail with `WEBVIEW_DRIFT` (exit 5). |
| `server start --webview <id>` | Start or reuse the workspace localhost server and return the selected installed view's authenticated URL. |

Use `node bin/forge.js webview inspect --project <id>` or `node bin/forge.js webview publish --project <id>` to target a project for one invocation without changing persistent selection. `--project` is this command's declared option; `--root <workspace>` (or `FORGE_ROOT`) selects the workspace. Publication requires a managed project whose marker has `type: "webview"`; it uses fixed `dist/` and `bin/webviews/<project-name>/` paths. The maintained `admin` view is reserved.

The CLI never installs dependencies, invokes npm scripts or starts a server during creation/publication. A publication dry run performs the same validation and revision checks as the write. Project scripts and dependency installation are separate operations with their own effects. `schema project --json`, `schema webview --json` and `schema server --json` describe the installed executable's exact arguments, schemas and errors.

## Build and manifest

The generated project owns its package, source, local fixture/model, tests and scripts. It starts with no system API dependency or token storage. Its public manifest becomes `dist/manifest.json` during the Vite build:

```json
{"id":"idea-board","name":"Idea board","entry":"index.html"}
```

The manifest ID must match the managed project name. The entry is exactly `index.html`; the name is a nonempty display label. Publish only the intended static output, including its entry and local assets. The server serves it under `/views/<id>/` with no history fallback or directory listing. Publication accepts HTML, JavaScript, CSS, JSON, SVG, PNG, JPEG, WebP, ICO, WOFF/WOFF2, `THIRD-PARTY-NOTICES.md` and regular nonhidden files under `licenses/`. It refuses symlinks, special files, hidden paths, `node_modules`, unsupported extensions and case-insensitive name collisions. Keep asset paths relative and package assets locally; see the [server asset contract](server.md#package-another-webview).

Each project installs and verifies itself. The starter's `npm run package` helper delegates to Forge publication; use the explicit CLI commands for dry runs and revision guards. Rebuilding Forge preserves locally installed custom views, but custom prototypes are not automatically included in the maintained Forge release archive. Keep the source project and publish it into each intended workspace explicitly.

## Inspect and guard a replacement

Inspection includes these fields in `data`:

| Field | Meaning |
| --- | --- |
| `id` | Managed project and installed view identifier. |
| `source` | Project-relative build directory, `dist`. |
| `destination` | Workspace-relative installed directory, `bin/webviews/<id>`. |
| `built` | Whether build output is available. |
| `installed` | Whether the destination exists. |
| `current` | Whether built and installed output agree. |
| `revision` | SHA-256 revision of the installed folder, or `null` before first publication. |
| `files` | Per-file comparison entries, with `missing`, `changed`, `unchanged` or `obsolete` status and source/installed revisions. |

`webview` without an action defaults to `inspect`. `--check` cannot be combined with `--if-match`; checking compares current files and never applies the replacement. Successful check responses add `checked: true` and `changed: false`. Publication responses include `changed`, `dryRun` and committed/planned `changes`.

To replace an existing publication after editing and rebuilding:

```sh
node bin/forge.js webview inspect --project idea-board --json
node bin/forge.js webview publish --project idea-board --if-match CURRENT_FOLDER_REVISION --dry-run
node bin/forge.js webview publish --project idea-board --if-match CURRENT_FOLDER_REVISION
node bin/forge.js webview publish --project idea-board --check
```

Replace `CURRENT_FOLDER_REVISION` with the inspected `data.revision`, and review the preview before applying. The guard covers the installed folder rather than only the manifest: changes to another published asset must also be reconciled. On `CONFLICT`, inspect again and review the changed files before choosing a new revision. Never blindly substitute a newer hash. Identical output can be published again without a guard because it changes nothing.

Publication updates the installed file set through Forge's write orchestration, with dry-run previews and committed change events. A rebuild that changes an existing path from a file into a directory, or the reverse, is refused with `WEBVIEW_INVALID`; use a new asset path before publishing. Obsolete files such as superseded hashed chunks are removed during an ordinary guarded update. Keep authored changes in the source project; direct edits in `bin/webviews` will differ from the build and affect the revision.

## Preview lifecycle and API access

Publication and server lifecycle are separate. A running server retains its initial view catalog: stop and start it to discover a newly published view or changed manifest. Coordinate this if other views are in use. Updating the assets of an already mounted view needs a browser reload. `server status` discovers installed views while stopped; `server start --webview <id>` returns the selected launch URL. See [localhost server](server.md).

Local fixtures are the starter's default. Optional real workspace inspection uses `GET /api/system`, the existing versioned read-only endpoint. Consumers must use its bearer-token handoff, validate the schema and availability flags, and handle missing access and stale data. The generated prototype does not gain a write API or arbitrary CLI execution endpoint.

## Errors

| Code | Recovery |
| --- | --- |
| `PROJECT_REQUIRED` | Select a valid managed project or pass the command's `--project <id>` option. |
| `WEBVIEW_PROJECT_REQUIRED` | The selected or named project has another type; `details` is `{project, type}`. Pass `--project <webview-id>` or run `project open <webview-id>`; `project list` shows each project's type. |
| `INVALID_ARGUMENT` | Use a project other than reserved `admin`, valid options and a SHA-256 revision when required. |
| `WEBVIEW_BUILD_REQUIRED` | Build the selected project, then inspect and retry publication. |
| `WEBVIEW_INVALID` | Correct the reported project, manifest or asset validation problem. |
| `WEBVIEW_DRIFT` | Inspect the comparison, rebuild if needed, and review a guarded publication; `--check` wrote nothing. |
| `CONFLICT` | Reread the installed folder revision and reconcile its changes before retrying. |

File/path validation and shared workspace errors retain their normal Forge contracts. Refer to `schema webview --json` for the full registered catalog and response schemas.
