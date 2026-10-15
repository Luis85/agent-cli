# Target a project for one invocation

[Documentation](../index.md) · How-to

Use `--project <id>` with `read`, `read-many`, `stat` and `apply` to resolve paths in a named managed project without changing the saved selection. This is useful when several agents share a workspace. Each invocation resolves its own target, and its response reports the executed `context.project` and `context.root`.

```sh
node bin/forge.js read src/example.ts --project alpha --json
node bin/forge.js apply plan.json --project alpha --dry-run --json
node bin/forge.js apply plan.json --project alpha --json
```

The example reads `src/example.ts` and loads `plan.json` from project `alpha`. Paths inside the plan also resolve within `alpha`. Plans supplied through standard input work the same way: `apply - --project alpha`. For an external scratch plan, pipe its bytes to standard input; a plan filename is always relative to the command's project scope.

Use the same explicit project for the initial read, preview and final apply. An `ifMatch` revision identifies file bytes, not project identity: identical files in two projects have the same revision. The target option chooses the scope; revision guards then reject changed content inside it. Dry-run, protected paths, contained paths and plan validation keep their existing behavior. See [make precise edits](make-precise-edits.md) for plan syntax and revision guards.

The option never runs `project open`, creates a project or changes `bin/data/context.json`. Unknown or invalid project IDs fail instead of falling back to the saved project or workspace. A valid explicit target also works when the saved selection is stale or absent. A command without `--project` continues using the saved selection, or workspace scope when none is selected.

`--project` is a command option on commands that declare it, not a global option. Put it after `read`, `read-many`, `stat` or `apply`; use `help <command>` and `schema <command>` to inspect support. `--root`, when needed, precedes the command and identifies the workspace that owns the named project. See [manage projects](manage-projects.md) for persistent selection.
