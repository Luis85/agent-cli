# Forge plugins and project CI

Read this when you write a Forge plugin or a project's CI workflows.

## Create a plugin
- `make plugin MyTools` writes `manifest.json` and `main.mjs` into workspace `bin/plugins/my-tools` (shared by every project; `--out` is not accepted). Review both, then add `my-tools` to `plugins.enabled` in `bin/config.json`.
- Plugins run trusted Node code with Node's permissions.

## Contributions
- Namespace commands, generators, events and services as `<plugin-id>.…`, skills as `<plugin-id>-…`, and error codes with the UPPER_SNAKE_CASE prefix.
- Declare each command's metadata: `scope`, `mutating`, described `options` and `args`, `errors`, and `destructive` or `idempotent` where the derived hints are wrong. `help`, `schema` and the invocation policy read it.
- Declare `output`, the JSON Schema of `data`, on the command or per action. Put options on the action that takes them. Add `schema` to a string option or argument that holds or names a JSON document.
- Settings: a JSON Schema read from `plugins.settings.<id>` through `context.settings`.
- German text in `strings.de`: descriptions of commands, actions, options, arguments and settings, the manifest name and description, error summaries and hints, and messages read with `context.t`.
- A skill is `{id, content}` with optional `files` (`{"references/x.md": "…"}`) that ship next to its SKILL.md.
- Share capabilities through `provides` and `requires`, never imports.

## Runtime rules
- Write through `context.workspace.write` so guards, dry runs and events apply.
- `onload(context)` and `onunload()` acquire and release resources, including after partial failures. `onUserEnable(context)` runs idempotent one-time setup at least once. `context.events.onLayoutReady` and `onQuit` run after activation and at invocation end.
- Emit only `<plugin-id>.*` events. Host events (`vault.*`, `metadataCache.*`, `workspace.*`, `operation.*`, `command.*`, `plugin.*`) and other plugins' events fail with `EVENT_OWNERSHIP`.
- To run the installed Claude Code CLI, require the `claude.lifecycle` service.
- Never log to stdout. Return JSON data and emit only JSON-safe event payloads.
- See `bin/data/docs/reference/plugins.md`.

## Project CI workflows
- Each project authors its workflows in `src/infrastructure/workflows/<concern>/*.yml`.
- From the workspace: `workflows sync --dry-run`, review, then `workflows sync` to generate the prefixed `.github/workflows/<project>--<concern>.yml` entrypoints.
- Never edit generated entrypoints; `workflows sync --check` exits 5 with `WORKFLOW_DRIFT` when they differ.
