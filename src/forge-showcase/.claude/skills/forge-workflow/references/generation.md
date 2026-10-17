# Generated output and feature commands

Read this when you generate UI or data-source code, manage agents, skills or Claude Code configuration, sync CI workflows, or build webviews and browser evidence. Each feature also has its own skill or reference page.

## UI components and data sources
- Inspect `components list`, `components inspect <id>` and `plugins.settings.ui` in `config --json` (framework and folders). The `ui` core plugin owns `components`, `interactions`, `make ui` and `make stories`; `data-sources` owns `data-sources` and `make data-source`.
- Component definitions are workspace-scoped; generated UI uses the active project or `--project <id>`. Start with `components init --dry-run` if there are none, and run `components validate` after edits.
- Preview `make ui <id> --framework <target> --project <id> --stories --dry-run`, check `context.root` and review the generated text.
- `--plan` compares proposed and current output, `--check` detects drift read-only (exit 5, `UI_DRIFT`) and `--plan-out <file.json>` writes a revision map. Intentional regeneration takes `--revisions-from <file.json>` with the inspected hashes.
- Generic file commands follow the open project: close it before guarded edits to the shared workspace library.
- CLI generation does not prove browser behavior or accessibility; test with the project's own toolchain. See `bin/data/docs/reference/ui-components.md`.

## Agents and skills
- Agent definitions are docker-agent YAML in `agents/*.yaml`: follow the `forge-agents` skill. `agents generate --target claude` maintains `.claude/agents/`; never hand-edit generated agents.
- `skills list` names the registered skills. `skills show <id>` returns SKILL.md and the list of the skill's `files`; `--file references/<name>.md` returns one of them.
- `skills install [--target both|claude|agents | --out <dir>]` writes each skill folder into the selected project's `.claude/skills` and `.agents/skills`. Existing different files are refused, so an edited skill is never overwritten.

## Claude Code configuration
- Use the `claude` command instead of hand-written JSON. `claude capabilities` lists hook events, handler types, plugin components and runtime operations.
- `claude hooks inspect` returns the settings document (`--scope project|local|user|plugin`, default `project`) with its `revision`; `hooks check` validates it; `hooks add|set|remove|enable|disable|configure` need `--if-match <revision>` once the file exists.
- `claude agents …` manages `.claude/agents/*.md`; `claude plugins create|inspect|manifest|check|asset|write-asset|remove-asset <dir>` authors a plugin folder without running Claude.
- `claude plugins list|install|…`, `claude marketplaces …` and `claude runtime …` run the installed `claude` executable and can change the user's installation: preview with `--dry-run`, keep `--scope project` and never pass `--scope user` without consent.
- Hooks and plugins run commands: review them like code. See `bin/data/docs/reference/claude.md`.

## CI workflows
- Each project authors workflows in its `src/infrastructure/workflows/<concern>/*.yml`. From the workspace run `workflows sync --dry-run`, review, then `workflows sync`.
- Never edit the generated `.github/workflows` entrypoints; `workflows sync --check` exits 5 with `WORKFLOW_DRIFT` when they differ.

## Webviews and browser evidence
- Prototype: follow the `forge-webviews` skill. `project create <id> --type webview`, build and test inside that project, `webview inspect --project <id>`, `webview publish --project <id> --dry-run`, then `server start --webview <id>`.
- Screenshots and illustrated tutorials: follow the `forge-browser` skill and `schema browser`. Dry runs validate without launching a browser.
