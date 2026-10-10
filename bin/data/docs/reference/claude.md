# Claude Code management

[Documentation](../index.md) · Reference

`claude` manages native Claude Code definitions and invokes an installed Claude Code CLI for plugin lifecycle operations. Native file operations use Forge's revisions, dry runs, path containment and post-commit events. See [manage Claude Code](../how-to/manage-claude.md) for complete editing workflows.

```sh
node bin/forge.js claude capabilities --json
node bin/forge.js help claude
```

The capabilities response lists supported hook events, handler types, plugin components and runtime operations. Forge preserves unknown metadata and extension fields while validating known fields. Claude Code determines whether those fields work in the installed version. The upstream references are [subagents](https://code.claude.com/docs/en/sub-agents), [hooks](https://code.claude.com/docs/en/hooks), [plugin components](https://code.claude.com/docs/en/plugins-reference) and [settings](https://code.claude.com/docs/en/settings).

## Scope and input

Native agent and hook operations use these targets:

| `--scope` | Agents | Hooks/settings |
| --- | --- | --- |
| `project` (default) | `.claude/agents/` | `.claude/settings.json` |
| `local` | Unsupported | `.claude/settings.local.json` |
| `user` | `<claude-dir>/agents/` | `<claude-dir>/settings.json` |
| `plugin` | `<directory>/agents/` | `<directory>/hooks/hooks.json` |

Project and local paths are relative to the selected Forge project's root, or the workspace if no project is selected. Plugin scope requires `--directory <relative-plugin-root>` in that same scope. Native plugin authoring commands take the plugin directory as a positional argument instead.

For native user scope, `--claude-dir <path>` overrides `CLAUDE_CONFIG_DIR`, which overrides `~/.claude`. A relative `--claude-dir` resolves from the selected Forge file scope. This option applies only to native user-scope operations. Reading or previewing a missing user directory does not create it. A committed native write creates missing directories through the guarded repository. Responses include `target.scope` and `target.directory`; check these before editing a user configuration outside the selected project. User scope selects the native configuration destination; Forge input/export paths and the runtime working directory still follow project selection.

Text inputs accept exactly one of `--from <path>`, `--content <text>` or `--stdin`. `--from` always reads from the current Forge file scope, including when the destination has user or plugin scope. Inputs must be UTF-8. Native mutation commands support `--dry-run`; a preview does not execute Claude, change files or emit `vault.*` events.

## Agents

| Command | Input and behavior |
| --- | --- |
| `claude agents list` | Lists native `.md` definitions, including malformed entries with diagnostics and revisions; reports duplicate agent names |
| `claude agents inspect <id>` | Returns metadata, prompt, path, bytes and revision |
| `claude agents create <id>` | Creates a native Markdown definition from text input, or `--metadata <JSON> --prompt <text>` |
| `claude agents update <id> --if-match <revision>` | Replaces the definition using the same input choices |
| `claude agents remove <id> --if-match <revision>` | Removes the inspected file, including a malformed definition |
| `claude agents disable <id>` | Adds an exact `Agent(name)` entry to the target settings' `permissions.deny` |
| `claude agents enable <id>` | Removes that exact deny entry; other permission restrictions remain |
| `claude agents export <id>` | Returns inspected data, rendered native Markdown in `content`, and a `session` object keyed by agent name; `--out <path.md>` also writes an editable copy |

An ID addresses a filename without `.md`; nested IDs such as `quality/reviewer` are supported. It is distinct from the frontmatter `name`. Creates never overwrite existing definitions. Updates and removals require the **agent file revision**. Enable/disable changes settings and requires the **settings file revision** when settings already exist; obtain it with `claude hooks inspect` using the same scope. These operations retain the agent file. Plugin agent enable/disable is unsupported; use the installed plugin lifecycle commands instead.

Export destinations resolve in the current Forge file scope, even when the native source uses user or plugin scope. A new destination needs no revision; replacing an existing export requires that **destination file's revision** through `--if-match`. Export supports `--dry-run`. Use a visible Markdown path for editing in Obsidian, where hidden `.claude` folders may not appear, then update the native agent with `--from` and its current **native agent revision**.

Definitions contain YAML frontmatter with required nonempty `name` and `description`, followed by a Markdown prompt. Known optional metadata includes `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `isolation`, `effort`, `color`, `initialPrompt`, `omitClaudeMd` and `experimental.cacheTtl`. Tool lists can be comma-separated strings or arrays. Unknown fields remain present; omitted fields are not expanded into defaults. Native source supplied to create/update is retained as authored after validation. The metadata/prompt convenience form and export render fresh YAML.

Claude ignores `hooks`, `mcpServers`, `permissionMode` and `initialPrompt` in plugin-provided agents. Forge reports that limitation and preserves the fields. Plugin-wide hooks and MCP configuration belong to the plugin manifest/assets. See the [upstream agent field contract](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields) for runtime inheritance, permissions and memory behavior.

## Hooks and settings

| Command | Input and behavior |
| --- | --- |
| `claude hooks inspect` | Returns the settings document, `hooks`, path and revision; a missing document has `revision: null` |
| `claude hooks check` | Validates the native hook configuration without running handlers |
| `claude hooks set` | Replaces only the document's `hooks` property from a raw event-map input |
| `claude hooks add <event>` | Appends one matcher-group object from input |
| `claude hooks remove <event> --if-match <revision>` | Removes all groups for that event |
| `claude hooks remove <event> --index <n> --if-match <revision>` | Removes one group by zero-based index |
| `claude hooks disable` | Sets `disableAllHooks: true` in project/local/user settings |
| `claude hooks enable` | Sets `disableAllHooks: false` in project/local/user settings |
| `claude hooks configure` | Merges explicitly supplied hook-policy keys into project/local/user settings |

Existing settings require their current `--if-match` revision for every mutation. When creating a missing document, omit the revision. Settings edits preserve unrelated keys, including permissions, plugin enablement and unknown extensions, but serialize the JSON with consistent indentation. Plugin hook files retain their outer wrapper and other keys. Plugin scope cannot use hooks enable/disable; enable or disable the installed plugin instead. Managed Claude policy may still constrain hook execution.

`configure` accepts a partial JSON object containing `disableAllHooks` and/or `allowManagedHooksOnly` booleans, and/or `allowedHttpHookUrls` and `httpHookAllowedEnvVars` string arrays. Other keys are rejected. It updates these keys without replacing the hook map. Plugin scope does not support policy configuration. Forge validates policy field types; Claude's settings precedence and managed-policy rules determine their effect.

`set` expects the value of `hooks`, without a surrounding `{"hooks": ...}` object. `add` expects one group containing a `hooks` array:

```json
{
  "PostToolUse": [
    {
      "matcher": "Write|Edit",
      "hooks": [{ "type": "command", "command": "node", "args": ["scripts/check.js"] }]
    }
  ]
}
```

Current supported events are `SessionStart`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`, `PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `MessageDisplay`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `TeammateIdle`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch`, `Elicitation`, `ElicitationResult` and `SessionEnd`.

| Handler type | Required fields | Other validated fields |
| --- | --- | --- |
| `command` | `command` | `args` string array, `shell` (`bash` or `powershell`), `async`, `asyncRewake` |
| `http` | HTTP(S) `url` | String-valued `headers`, `allowedEnvVars` string array |
| `mcp_tool` | `server`, `tool` | `input` object |
| `prompt` | `prompt` | `model` |
| `agent` | `prompt` | `model` |

Common fields are `if`, `timeout` in seconds, `statusMessage` and `once`. Forge checks their types and supported event/type combinations without evaluating commands, permission rules, matchers, prompts or interpolation. It retains matcher strings even on events where Claude ignores them.

`SessionStart` and `Setup` accept command/MCP-tool configuration only; `PermissionRequest` excludes agent handlers. Other restrictions are listed per event in `claude capabilities`. Claude skips MCP-tool hooks before MCP clients are available: this includes every Setup invocation and the initial SessionStart. `once` takes effect only for skill-frontmatter hooks, not settings or agent-frontmatter hooks. See the [official handler and event reference](https://code.claude.com/docs/en/hooks#hook-handler-fields) before relying on runtime behavior.

## Authored plugins

These commands address a contained directory in the current Forge scope. They do not install the plugin.

| Command | Behavior |
| --- | --- |
| `claude plugins create <directory>` | Creates `.claude-plugin/plugin.json` from a native manifest JSON input |
| `claude plugins inspect <directory>` | Returns manifest, its revision, and regular plugin files |
| `claude plugins manifest <directory> --if-match <revision>` | Replaces the manifest from JSON input |
| `claude plugins check <directory>` | Returns `valid`, diagnostics and `validation: "structure"`; inspect `data.valid` even when the command succeeds |
| `claude plugins asset <directory> <path>` | Reads a plugin-relative asset and its revision; returns a text view when it is UTF-8 |
| `claude plugins write-asset <directory> <path>` | Creates or replaces an asset from input; replacement needs `--if-match` |
| `claude plugins remove-asset <directory> <path> --if-match <revision>` | Removes exactly one asset |

`write-asset` preserves raw bytes from `--from` or `--stdin`; `--content` supplies UTF-8 text. Asset paths are relative to the plugin root. Native definitions are validated where recognized; other assets are stored without executing them. Removal preserves surrounding directories and does not remove other files or repair manifest references automatically.

`create` writes a manifest. `inspect` and `check` also accept existing plugins without one when regular plugin files are present; inspection returns `manifest: null`, `revision: null` and an inferred name. Supported component declarations include skills, commands, agents, hooks, MCP/LSP servers, output styles, workflows, settings, themes, monitors, evals, type declarations and channels. Run `claude capabilities` for accepted manifest forms and default paths. Unknown fields are preserved. Hook declarations inline in a manifest use a raw event map; a referenced hook JSON file uses a `hooks` wrapper, or `modules` for a Claude mod. Plugin settings support `agent` and `subagentStatusLine`; Claude controls loading of other preserved settings.

Structural checks verify known manifest/asset shapes, contained paths and referenced regular files. A declared component directory with no regular files produces a warning because it may be empty or absent. The checks do not start hook scripts, MCP servers, LSP executables, mods or Claude sessions, and do not verify installed-version compatibility. Use `claude plugins validate <directory>` for the installed Claude CLI's own validation.

## Installed Claude CLI operations

These commands launch the executable named `claude`, or `--claude-bin <executable-path>`, with the current Forge root as its working directory. They require an installed Claude Code CLI; native authoring and dry-run planning do not.

| Forge command | Native command | Options |
| --- | --- | --- |
| `claude plugins list` | `claude plugin list --json` | `--available`, `--data-size <id>` or `--data-size ''` for all |
| `claude plugins details <id>` | `claude plugin details <id>` | — |
| `claude plugins install <id>` | `claude plugin install <id> --json` | `--scope user\|project\|local`, `--yes` or `--accept-command <sha256>`, `--config <key=value or JSON array>` |
| `claude plugins update <id>` | `claude plugin update <id> --json` | `--scope user\|project\|local\|managed`, `--yes` or `--accept-command <sha256>` |
| `claude plugins uninstall <id>` | `claude plugin uninstall <id> --json` | `--scope user\|project\|local`, `--keep-data`, `--prune`, `--yes`; `--prune` omits native `--json` |
| `claude plugins enable <id>` | `claude plugin enable <id> --json` | `--scope user\|project\|local` |
| `claude plugins disable <id>` | `claude plugin disable <id> --json` | `--scope user\|project\|local`; alternatively `disable --all` without an ID or scope |
| `claude plugins validate <path>` | `claude plugin validate <path> --json` | `--strict` |
| `claude plugins configure <name@marketplace>` | `claude plugin configure <name@marketplace> --json` | `--values-stdin` with a Forge text input source |
| `claude plugins prune` | `claude plugin prune` | `--scope user\|project\|local`, `--yes` |
| `claude plugins init <name>` | `claude plugin init <name>` | `--description`, `--author`, `--author-email`, `--with <component or JSON array>`, `--force` |
| `claude plugins tag [path]` | `claude plugin tag [path]` | `--message`, `--remote`, `--push`, `--force` |
| `claude plugins test [directory]` | `claude plugin test [directory]` | — |
| `claude plugins eval [target]` | `claude plugin eval [target]` | See evaluation options below |
| `claude plugins eval init <case-name>` | `claude plugin eval init <case-name>` | `--bare`, `--eval-dir`; interactive authoring requires invoking Claude directly |
| `claude marketplaces add <source>` | `claude plugin marketplace add <source>` | `--scope user\|project\|local`, `--sparse <path or JSON array>`; alternatively `--claudeai` without scope or sparse |
| `claude marketplaces list` | `claude plugin marketplace list --json` | — |
| `claude marketplaces remove <name>` | `claude plugin marketplace remove <name>` | `--scope user\|project\|local` |
| `claude marketplaces update [name]` | `claude plugin marketplace update [name]` | — |
| `claude runtime version` | `claude --version` | — |
| `claude runtime doctor` | `claude doctor` | — |
| `claude runtime install [version\|stable\|latest]` | `claude install [version\|stable\|latest]` | Requires an already callable Claude executable |
| `claude runtime update` | `claude update` | — |

Commands supporting `--scope` default to `project` and pass it explicitly, including marketplace removal. The exceptions are `plugins disable --all` and `marketplaces add --claudeai`, which reject scope and use native behavior. Other commands reject that option. Native `plugins init` creates a plugin under `~/.claude/skills/<name>`; it has no project destination or scope option. Use Forge's `plugins create <directory>` to author a manifest in a selected project. Runtime operations inherit the process environment, including `CLAUDE_CONFIG_DIR`; the native-file `--claude-dir` option does not apply to them.

Pass each list option as one argument: for example, `--with '["agents","hooks"]'`, `--sparse '["plugins/a","plugins/b"]'`, `--allow-tools '["Read","Grep"]'` or `--config '["host=localhost","port=8080"]'`. Allowed `--with` components are `skills`, `agents`, `hooks`, `mcp`, `lsp`, `output-style` and `channel`. `--config` expands into repeated native options; use configuration stdin for sensitive values because process arguments and dry-run plans contain option values.

`plugins configure` without `--values-stdin` reads saved configuration. With `--values-stdin`, provide exactly one of `--from`, `--content` or `--stdin` containing a JSON object whose values are single-line strings. Numeric and boolean plugin options must also be represented as strings. Only supplied values are changed; omitted values remain. Forge pipes this input to Claude rather than placing it in arguments. Its plan includes only `inputBytes`, not the payload. Claude controls redaction in its own output; Forge retains that output. Prefer `--stdin` over literal `--content` for secrets to keep them out of shell history and process arguments.

Evaluation options follow the [native eval contract](https://code.claude.com/docs/en/plugin-evals):

| Options | Accepted values and behavior |
| --- | --- |
| `--runs`, `--concurrency` | Positive integers; concurrency is 1–8 |
| `--model`, `--judge-model`, `--ablation` | Model identifiers; ablation is `none` or `with-without` |
| `--threshold`, `--max-cost-usd` | Threshold 0–1; nonnegative cost limit |
| `--eval-dir`, `--case`, `--tag` | Directory, one case glob, or one tag/JSON array of tags |
| `--allow-tools`, `--allow-real-servers`, `--trust-plugin` | Tool string/JSON array and explicit native execution permissions |
| `--mocks`, `--scaffold`, `--no-scaffold` | Mocks `record` or `off`; scaffold switches are mutually exclusive |
| `--output-dir`, `--keep-temp`, `--verbose` | Report directory and native diagnostic options |
| `--native-json`, `--native-json-output <path.json>` | Emit native JSON on stdout, or write it to the named `.json` file; either option enables native JSON mode |
| `--no-publish`, `--publish-report` | Mutually exclusive report publication controls |

For a plugin-directory target, `--eval-dir` is relative to that plugin. For `eval init`, it is relative to the current Forge root. Native Claude requires relative directory names without `..`. For example, eval of `plugins/team-tools` uses `--eval-dir evals`, while init from the project root can use `--eval-dir plugins/team-tools/evals`. A native JSON output path resolves from the native working directory and is written by Claude, outside Forge's revision guards. `--native-json-output` takes precedence if both native JSON options are supplied; Forge does not read that result file back into its response.

An executed eval makes model calls, may run plugin code, and incurs native account usage. Depending on the native environment, it may publish a private report to Claude; use `--no-publish` to keep reports local. Native `test` executes authored mod tests, and `tag --push` can publish a Git tag. Forge forwards execution, acceptance, force and publication switches only when explicitly supplied. `prune` can require `--yes` to remove anything without a terminal. `eval init` requires a case name in Forge and rejects `--interactive` before starting Claude because Forge provides no terminal.

`--dry-run` validates inputs and returns the executable, argument array and working directory without starting a process. Forge uses no shell or interactive terminal. It closes subprocess stdin except for `configure --values-stdin`. A command that needs interactive input may fail or time out. Runtime `--timeout` is milliseconds, from 1 to 3,600,000; the default is 120,000. This differs from hook-handler `timeout`, which is seconds. Configuration input and captured output are each limited to 1 MiB. Responses retain native `exitCode`, `stdout` and `stderr`.

Cancellation, timeout and output-limit failures request termination of the native process group on POSIX. Windows cleanup targets the direct process; descendants may survive. Error details report `terminationScope`, `terminationRequested` and any `terminationError`. SIGINT/SIGTERM cancellation preserves status 130/143. Inspect external state before retrying; termination cannot undo completed work. A child that closes configuration input early cannot be reported as a successful configuration write merely because it exits zero.

The output protocol follows the selected command. Lists, configuration and validation use a complete JSON document. Install/update/enable/disable/uninstall use JSON on the last stdout line, retaining any preceding native messages; uninstall with `--prune` uses text because Claude disallows that combination with JSON. Eval uses a complete JSON document only with `--native-json` and no output file. Other text output is retained without treating JSON-looking messages as structured results. Parsed output is exposed as `result`, including in error details for nonzero exits. Validation failures therefore retain per-file diagnostics, and a refused install/update can expose `shownCommand.sha256` for an explicit `--accept-command` retry.

Native status remains significant: enable/disable can exit 1 with `alreadyInGoalState: true`; eval exits 2 for partial runs and 130/143 for interruption/termination. A nonzero status remains a Forge error with the native status and any parsed result, rather than becoming an automatic success or retry. `--yes` and `--accept-command` have no effect when Claude itself invokes these operations inside a Claude Code session; use your own terminal for native acceptance.

Forge supports the explicitly listed options from the [official plugin CLI reference](https://code.claude.com/docs/en/plugins/cli-reference). Mutation JSON requires Claude Code v2.1.268 or later; native validation JSON requires v2.1.259, eval v2.1.269, hash acceptance v2.1.271, and configuration v2.1.285. Forge does not silently retry with older output formats or upgrade the installed CLI. Check `claude runtime version` when a command is unsupported.

Native version-specific flags outside this list are rejected. In particular, eval's `--report` is not exposed because the upstream reference does not specify its argument contract; use the installed `claude plugin eval --help` and native CLI for it. Forge's `--json` controls its response envelope; eval's `--native-json` and `--native-json-output` select Claude's own JSON output. Installed releases may support fewer documented commands or flags.

A missing installation reports `CLAUDE_NOT_INSTALLED`. Failed or interrupted native operations may already have changed Claude's installation state; inspect the captured output and installed state before retrying. Forge revision guards and `vault.*` events cover its own file mutations, not changes made by the native executable. The repository verifies this integration using fixture executables; it does not claim end-to-end verification against an installed Claude Code release.

The host's `claude.started`, `claude.succeeded` and `claude.failed` events cover service validation, previews, execution and output processing with a shared invocation-local `operationId`. Payloads identify the executable, `cwd` and dry-run state, plus received exit status or a safe error code/status summary when applicable; they exclude native arguments, stdin, stdout and stderr. The original diagnostics remain in the command response. `claude.executed` remains available whenever a process returns an exit status, including a nonzero status; previews and process failures without a status do not emit it. A native exit of zero can still precede `claude.failed` if JSON parsing fails, so inspect external state before retrying. These Forge notifications are separate from Claude's configured hook events. See the [host event contract](plugins.md#host-events-and-correlation).

## File integrity

All native authoring writes use contained regular-file paths, collision checks and SHA-256 revisions. Dry runs produce the same validation and planned changes without writing. A stale revision fails with `CONFLICT`; reread and reconcile instead of reusing it. Removal emits `vault.delete` only after success; its `revision` and `bytes` identify the removed content. Created and replaced files emit `vault.create` and `vault.modify`, and each newly created folder emits `vault.create` with `kind: "folder"`. Listener failures become warnings after persistence. See the [write contract](cli.md#write-contract).
