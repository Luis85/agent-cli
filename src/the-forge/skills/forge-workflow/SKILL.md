---
name: forge-workflow
description: Drive the portable Forge CLI (node bin/forge.js) safely. Discover commands with help and schema, pick the workspace and project, preview writes with --dry-run, guard them with --if-match, retry lost writes and recover from error codes. Use when a workspace has bin/forge.js, when starting any Forge task, or when a Forge command fails.
license: MIT
compatibility: Requires Node.js 22.12 or newer and The Forge distribution in the workspace bin folder.
metadata:
  author: The Forge
  version: "0.1.0"
---

Every command prints one JSON envelope and never prompts. Check the exit code and `ok`, and match `error.code`, never message text.

## Root and scope
- The workspace is the folder holding `bin/`, not your working directory. Pick another with `--root <dir>` or `FORGE_ROOT=<dir>`; `--root` wins, and a missing root fails with `INVALID_ROOT`.
- Paths are relative to `context.root`: the open project, or the workspace. Check `project current`. `project open <id>` changes the selection for every agent, and `project close` clears it.
- With parallel agents, leave the selection alone and pass `--project <id>` to file commands (`read`, `search`, `edit`, `apply`…).

## Discover
- `help` lists commands. `help <command>` gives usage, examples, options and error codes. `schema <command>` gives the JSON Schema input and output.
- Avoid `schema --all`: it is every command at once.
- Global flags such as `--root`, `--dry-run` and `--wait` may come before or after the command.

## Safe edit loop
1. `read <path>` and keep `data.revision`.
2. Run the change with `--dry-run --if-match <revision>` and review `data.changes[].diff`.
3. Rerun it without `--dry-run`, then read the file back.
4. Change several files at once with one `apply <plan.json>`: all or nothing, with `ifMatch` on every existing path.
5. After note changes, run `vault check --strict` until it passes.

## Arguments
- Quote every value, and quote empty variables (`--replace "$X"`). An option never takes the next flag as its value: it fails with `MISSING_ARGUMENT`.
- Write a value that starts with `-` as `--key=value` (`--find=--draft`). Pass multiline or shell-sensitive text with `--stdin`.

## Bounded output
- `read` truncates at 256 KiB (`truncated: true`); read on with `--lines <a>-<b>`.
- `list` returns 500 files per page and `search` 100 hits. Repeat with `--cursor <nextCursor>` until it is absent.
- Narrow with `--path <folder or glob>`, `--kind`, or `search --files-only` / `--count`. Check `warnings` too.

## Retries
- Lost track of a write? Run it again. `operation: "unchanged"` or `alreadyApplied: true` means it already happened.
- A repeated `delete` fails with `NOT_FOUND`; `details.alreadyDeleted` and `details.trashPath` show it already succeeded.
- Retry an unchanged command only when `error.retryable` is true.

## Errors
Exit codes: 1 runtime, 2 input or conflict, 3 not found, 4 busy, 5 drift, 130/143 interrupted. Every error has a `hint`.
- `CONFLICT`: reread the file and reapply your change to its current content. If `details.alreadyApplied` is true, the change is already there. Never resend the old change unchanged.
- `NO_MATCH`: copy the exact text, using `details.nearMatch` and `details.lineEndings`.
- `AMBIGUOUS_EDIT`: extend `--find` until it matches once (`details.lines`).
- `UNKNOWN_COMMAND`, `UNKNOWN_OPTION`: see `details.suggestions` and `help <command>`.
- `INVALID_PATH`: use `details.suggestion`.
- `NOT_FOUND`: check `details.path` and `project current`.
- `WORKSPACE_BUSY`: wait `details.retryAfterMs`, or pass `--wait <ms>`.
- `ROLLBACK_FAILED`: inspect every listed file before continuing.

## Reference
- [Protocol](references/protocol.md): envelope, events, warnings, language, plugins and other error codes.
- [Workspace](references/workspace.md): install, setup, updates, projects, templates, quality gates and the admin server.
- [Generation](references/generation.md): UI, data sources, agents, skills, Claude Code, workflows, webviews and browser.
- Notes, Canvas, Bases and attachments: the `forge-vault` skill.
