# Workspace, projects and checks

Read this when you install or upgrade Forge, set up a workspace, work with projects or templates, run quality gates or start the admin view. The core loop is in [SKILL.md](../SKILL.md).

## Install and upgrade
- New workspace from a release: follow `bin/data/docs/how-to/install.md`. Download the trusted release's `install-forge.mjs`, run it with `--version` and `--workspace`, and check its exit status and JSON `ok`. It verifies the archive checksum, installs generic defaults, runs setup and refuses an existing `bin/`. Do not copy a source checkout's saved selection.
- Existing workspace: `setup --dry-run`, then `setup`. It always targets the workspace and adds only missing files: the distribution, `bin/config.json`, the skills, an example `bin/templates/entity.md` and a lean `AGENTS.md`. Existing files are skipped.
- Self-upgrade: `update check`, then `update apply --release-version <version> --if-match <revision> --dry-run`, then the same command without `--dry-run`. A dry run downloads nothing. Upgrades keep configuration, project selection, plugins, templates and custom webviews. On `CONFLICT`, inspect again. Afterwards check `--version` and `project current`, and restart a running server. See `bin/data/docs/reference/updates.md`.

## Projects
- `project list` lists the valid projects and, under `invalid`, project folders whose `.forge/project.json` is broken (`{directory, code, reason}`).
- `project inspect <id>`, `project open <id>`, `project current`, `project close`. The selection lives in `bin/data/context.json` and is shared by every invocation.
- With `--project <id>`, use the same project for the read, the preview and the write: a revision identifies bytes, not the project. An unknown project fails instead of falling back.
- Checking `project current` does not lock the selection. Coordinate selection changes with other agents, or use separate workspaces when agents need different selections.
- `STALE_PROJECT_CONTEXT` names the selected `project` and `directory` with the cause: open a valid project or `project close`.
- New code project: `project create <kebab-name> --dry-run` (`--type webview` for a prototype). New domain or application file: `project component [id] <PascalName> --kind domain|application --dry-run`; omit the id for the open project.
- Shared templates always live in workspace `bin/templates` and plugins in `bin/plugins`.

## Templates and documents
- `templates list`, then `templates inspect <name.md>` for its required values.
- `make document <Title> --template <name.md> --values-from <inputs.json> --dry-run`; review the full text before applying. `--date <ISO>` makes dates repeatable.
- Workflow stages: `templates inspect workflow/prd.md`, `templates install workflow --dry-run`, then `make document <Title> --template workflow/<kind>.md --values '{"owner":"Team"}' --dry-run`. See `bin/data/docs/tutorials/idea-to-production.md`. A drafted document is not a completed requirement.
- When the `templates` or `scaffolds` core plugin is disabled, its commands and generators are unknown, `setup` skips the templates with a warning and `project create` fails with `PLUGIN_UNAVAILABLE`.

## Checks and reporting
- For generated TypeScript projects, run `npm run check:fast` from the project folder while you work, fix the cause of each failure, rerun the failed stage and finish with `npm run check`. For other projects, read their scripts first.
- Never weaken a gate to hide a failure.
- Summarize changed files, acceptance evidence, checks run and remaining limits.

## Admin view
- Only after the user agrees: `server start --webview admin` and share `data.url`. The CLI never opens a browser.
- `server status` is read-only, `server start` reuses a running server and `server stop` ends it. Start and stop support `--dry-run`.
- The URL fragment holds a bearer token: treat it as local session access, and fetch a fresh link after a restart. See `bin/data/docs/reference/server.md`.
