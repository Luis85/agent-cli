# Manage Claude Code definitions and plugins

[Documentation](../index.md) · How-to

Use this workflow to maintain native Claude agents, hooks and authored plugins, then operate installed plugins through Claude's own CLI. The [Claude reference](../reference/claude.md) lists exact scopes, options and validation limits.

## Choose the target and inspect it

```sh
node bin/app.js project current --json
node bin/app.js claude capabilities --json
node bin/app.js claude agents list
node bin/app.js claude hooks inspect
```

The default target is `.claude` inside the selected project, or the workspace when none is open. Check the response's `context` and `target` before writing. Add `--scope user` for your user configuration, optionally with `--claude-dir /absolute/path/to/claude-config`. Without that override, Forge uses `CLAUDE_CONFIG_DIR` or `~/.claude`. Inspection and previews leave a missing directory absent.

Use `--scope plugin --directory plugins/team-tools` to maintain an authored plugin's agents or hook file. Use `--scope local` only for `.claude/settings.local.json` hooks/settings. Input paths supplied through `--from` still resolve in the current Forge file scope.

## Create and revise an agent

Create `reviewer` from native Markdown using `--from drafts/reviewer.md`, or supply frontmatter and prompt separately:

```sh
node bin/app.js claude agents create reviewer --metadata '{"name":"reviewer","description":"Review changes and report concrete defects","tools":["Read","Grep","Glob"]}' --prompt 'Inspect the requested changes. Report actionable findings with evidence.' --dry-run
node bin/app.js claude agents create reviewer --metadata '{"name":"reviewer","description":"Review changes and report concrete defects","tools":["Read","Grep","Glob"]}' --prompt 'Inspect the requested changes. Report actionable findings with evidence.'
node bin/app.js claude agents inspect reviewer --json
```

Copy `data.revision` from inspection. To apply an authored replacement:

```sh
node bin/app.js claude agents update reviewer --from drafts/reviewer.md --if-match AGENT_REVISION --dry-run
node bin/app.js claude agents update reviewer --from drafts/reviewer.md --if-match AGENT_REVISION
node bin/app.js claude agents export reviewer --json
```

The replacement source retains its authored frontmatter and prompt. `export` also provides rendered Markdown and a structured session definition. A conflict means the file changed; read it again and reconcile before retrying. `agents list` includes malformed files with their revisions so they can be repaired or removed.

For editing in Obsidian, export a visible Markdown copy: hidden `.claude` folders may not appear in its file explorer.

```sh
node bin/app.js claude agents export reviewer --out agent-notes/reviewer.md --dry-run
node bin/app.js claude agents export reviewer --out agent-notes/reviewer.md
```

Choose a new destination, or inspect an existing destination with `read agent-notes/reviewer.md` and provide its revision through `--if-match` when exporting. The destination is in the current Forge file scope even if the native agent uses `--scope user` or `--scope plugin`. Edit the exported Markdown in Obsidian, inspect the native agent again, then use `agents update reviewer --from agent-notes/reviewer.md --if-match AGENT_REVISION`. Keep the source's scope flags on inspection and update. The native revision guards the update; the editable copy's revision is only used when replacing that copy.

To disable delegation without removing the agent, inspect the **settings** revision first:

```sh
node bin/app.js claude hooks inspect --json
node bin/app.js claude agents disable reviewer --if-match SETTINGS_REVISION --dry-run
node bin/app.js claude agents disable reviewer --if-match SETTINGS_REVISION
```

Omit `--if-match` if inspection reports `revision: null`. Disable adds an exact `Agent(reviewer)` deny rule and retains other settings. Enable removes that rule after another settings inspection; other permission policies may still deny the agent. Plugin agents are controlled through their installed plugin instead.

To remove the definition, inspect it and use its current **agent file** revision:

```sh
node bin/app.js claude agents remove reviewer --if-match AGENT_REVISION --dry-run
node bin/app.js claude agents remove reviewer --if-match AGENT_REVISION
```

The committed response includes `file.deleted` with the removed file's hash and size. Removal leaves sibling files and directories in place.

## Maintain hooks without replacing other settings

Prepare a UTF-8 `drafts/hooks.json` containing the raw event map, without a `hooks` wrapper:

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

Use a command you have reviewed and whose script exists in the intended Claude runtime. Forge stores this configuration without running the script.

```sh
node bin/app.js claude hooks inspect --json
node bin/app.js claude hooks set --from drafts/hooks.json --if-match SETTINGS_REVISION --dry-run
node bin/app.js claude hooks set --from drafts/hooks.json --if-match SETTINGS_REVISION
node bin/app.js claude hooks check
```

Omit the revision when creating a missing settings file. `set` replaces only its `hooks` value. To append one group, use `claude hooks add PostToolUse --content '{"matcher":"Write","hooks":[{"type":"command","command":"node","args":["scripts/check.js"]}]}' --if-match SETTINGS_REVISION`. Use a fresh settings revision for every committed change.

Remove one matcher group with `claude hooks remove PostToolUse --index 0 --if-match SETTINGS_REVISION`; omit `--index` to remove the entire event entry. `claude hooks disable` and `enable` update `disableAllHooks` in project/local/user settings with the same revision rules. Managed Claude policy still applies. Plugin hook enablement follows the installed plugin.

For other hook policy, use `claude hooks configure --content '{"allowedHttpHookUrls":["https://hooks.example.com/*"],"httpHookAllowedEnvVars":["HOOK_TOKEN"]}' --if-match SETTINGS_REVISION --dry-run`, review the preview, then repeat without `--dry-run`. Configuration accepts these two string lists plus `disableAllHooks` and `allowManagedHooksOnly` booleans; it preserves all unrelated settings and the hook map. Claude determines the effective policy after combining settings scopes.

Hook validation covers configuration structure and supported event/type combinations. It does not evaluate matchers or run command, HTTP, MCP-tool, prompt or agent handlers. Consult the [native hook contract](../reference/claude.md#hooks-and-settings) for startup/MCP restrictions and handler options.

## Author and check a plugin

```sh
node bin/app.js claude plugins create plugins/team-tools --content '{"name":"team-tools","version":"0.1.0","description":"Shared review tools"}' --dry-run
node bin/app.js claude plugins create plugins/team-tools --content '{"name":"team-tools","version":"0.1.0","description":"Shared review tools"}'
node bin/app.js claude agents create reviewer --scope plugin --directory plugins/team-tools --from drafts/reviewer.md
node bin/app.js claude plugins check plugins/team-tools
```

Inspect `data.valid` and every diagnostic from `check`. Plugin agents retain native metadata, but Claude ignores their `hooks`, `mcpServers`, `permissionMode` and `initialPrompt` fields. Define plugin-wide hooks and servers in the manifest or corresponding native assets.

Use `claude plugins asset plugins/team-tools README.md` to inspect an asset and its revision. Create a text asset with `claude plugins write-asset plugins/team-tools README.md --from drafts/plugin-readme.md`; replace it with the same command plus its current `--if-match` revision. `--from` and `--stdin` also preserve binary asset bytes; `--content` supplies UTF-8 text. Use `claude plugins manifest` with manifest JSON and its inspected revision to revise component declarations, and `claude plugins remove-asset` with an asset revision to remove one file. Preview each mutation with `--dry-run` and recheck plugin references afterward.

Forge's structural check does not execute plugins or establish Claude runtime compatibility. When Claude is installed, request its own validator:

```sh
node bin/app.js claude plugins validate plugins/team-tools --strict
```

## Manage installed plugins and marketplaces

Verify the executable, then preview installation operations:

```sh
node bin/app.js claude runtime version
node bin/app.js claude marketplaces add owner/marketplace-repository --scope project --dry-run
node bin/app.js claude marketplaces add owner/marketplace-repository --scope project
node bin/app.js claude plugins list --available
node bin/app.js claude plugins install team-tools@marketplace-name --scope project --dry-run
node bin/app.js claude plugins install team-tools@marketplace-name --scope project
```

Replace the example marketplace source and plugin ID with actual identifiers. `--claude-bin /path/to/claude` selects another executable. Commands that support scope default to `project`; the [runtime operation table](../reference/claude.md#installed-claude-cli-operations) identifies which commands accept it.

Use `claude plugins details <id>` to inspect an installed plugin, and `update`, `enable`, `disable` or `uninstall` with the plugin ID and desired scope. `disable --all` takes neither a plugin ID nor a scope. `list --data-size ''` requests data sizes for all installed plugins; supply a plugin ID instead of the empty argument to inspect one. `prune --scope project` inspects orphaned dependencies; add `--yes` explicitly when you intend native removal without a terminal. Uninstalling a plugin's final installation may remove its stored configuration, secrets and data; `--keep-data` preserves data only.

Use `claude marketplaces list`, `update [name]` or `remove <name>` to maintain sources. Removal defaults explicitly to project scope and may uninstall associated plugins when removing the marketplace's final registration. For sparse repository checkout, pass `--sparse '["plugins/team-tools","plugins/shared"]'` to `marketplaces add`. Its alternative `--claudeai` mode uses the Claude account and cannot be combined with scope or sparse paths.

`claude runtime doctor` captures the native diagnostic command's output. `claude runtime update` and `claude runtime install [version|stable|latest]` invoke the installed executable's maintenance commands. These do not bootstrap a missing executable; install Claude through its official distribution first if `runtime version` reports `CLAUDE_NOT_INSTALLED`.

Forge starts native commands without a shell or interactive terminal. It only forwards acceptance switches such as `--yes`, `--accept-command <sha256>` and `--force` when you supply them. Install/update failures can return `error.details.result.shownCommand`; inspect that command, then pass its `sha256` as `--accept-command` only if you intend to run it. Claude ignores native acceptance flags inside a Claude Code session, so run an acceptance retry from your own terminal. `--dry-run` never starts Claude. `--timeout 180000` sets a three-minute runtime limit. A native operation can change installation state before failing, so inspect that state before retrying.

Mutation commands request native JSON automatically and require Claude Code v2.1.268 or later; uninstall with `--prune` uses native text output. Forge retains captured output and parses the command's documented JSON protocol on both success and failure. For example, failed native validation retains its per-file diagnostics under `error.details.result`. Enable/disable may fail with `alreadyInGoalState: true`; inspect this structured status instead of assuming an installation is broken. Older native versions are not automatically upgraded or retried with different arguments.

## Configure installed plugin options

Read current options using the full plugin identifier returned by `plugins list`:

```sh
node bin/app.js claude plugins configure team-tools@marketplace-name
```

To change options, prepare JSON mapping keys to single-line strings. Use strings even for numeric or boolean options. Omitted keys retain their saved values. For example, a private local input file might contain `{"host":"localhost","port":"8080"}`:

```sh
node bin/app.js claude plugins configure team-tools@marketplace-name --values-stdin --stdin --dry-run < /private/path/plugin-values.json
node bin/app.js claude plugins configure team-tools@marketplace-name --values-stdin --stdin < /private/path/plugin-values.json
```

Replace the redirected path with your local file. Forge validates the JSON and pipes it directly to Claude, with a 1 MiB input limit. The dry-run plan includes an input byte count and omits values. `--from <path>` also works for a file in the current Forge scope. Avoid literal `--content` or installation `--config` for secrets because those values enter shell history or process arguments. Claude controls redaction in its returned configuration; Forge preserves the native output.

For non-sensitive installation defaults, pass one value with `--config host=localhost` or several with `--config '["host=localhost","port=8080"]'`. This expands to the native CLI's repeated configuration flags. Availability of configuration commands and options depends on your installed Claude version.

## Run native plugin development commands

Native scaffolding differs from Forge's contained manifest creation: `claude plugins init team-tools --with '["agents","hooks"]'` creates a plugin under `~/.claude/skills/team-tools`. It does not accept `--scope` or an output directory. Optional metadata flags are `--description`, `--author` and `--author-email`; use `--force` only for an intended native overwrite. Use `claude plugins create plugins/team-tools` with manifest input for project-local authoring.

`claude plugins test plugins/team-tools` executes the plugin's mod tests. `claude plugins tag plugins/team-tools --message 'Release review tools'` invokes native Git tagging; add `--push` explicitly to publish the tag. `--remote` selects the remote, and `--force` requests native tag replacement. These commands execute through Claude and do not use Forge file revisions.

For evaluations, create a named case and inspect its generated files before running it:

```sh
node bin/app.js claude plugins eval init review-case --eval-dir plugins/team-tools/evals --bare --dry-run
node bin/app.js claude plugins eval init review-case --eval-dir plugins/team-tools/evals --bare
node bin/app.js claude plugins eval plugins/team-tools --eval-dir evals --runs 1 --concurrency 1 --max-cost-usd 2 --no-publish --native-json --timeout 600000 --dry-run
```

After authoring the case, remove `--dry-run` to run it. `--eval-dir` is relative to the plugin for eval, and to the current Forge root for init. An executed eval makes model calls using the native account, incurs usage, and may execute plugin code. `--no-publish` requests local reports; native defaults may publish a private report to Claude depending on the environment. Use `--output-dir <path>` for report files and `--model` / `--judge-model` to select models. Native cost limits and runtime timeouts govern different parts of the run; interrupted commands may leave partial results.

`--native-json` requests Claude's structured eval result on stdout, which Forge exposes as `result`. On a failed or partial run it appears under `error.details.result` with the native exit status; exit 2 signals a partial run, including a cost limit or initial credential failure. Use `--native-json-output reports/review.json` instead to have Claude write the result to a `.json` file relative to the current Forge root. Claude owns that write and Forge does not read the file back or apply file revision guards. Neither option changes report publication; keep `--no-publish` when you want local reports.

Filter cases with `--case <glob>` or `--tag '["smoke","review"]'`. The [runtime reference](../reference/claude.md#installed-claude-cli-operations) lists all evaluation flags, including ablation, mocks, scaffolding and explicit execution permissions. Forge forwards `--allow-tools`, `--trust-plugin`, `--allow-real-servers` and `--publish-report` only when supplied; native defaults still apply. Forge rejects `eval init --interactive` before execution; invoke `claude plugin eval init` directly in your terminal for an authoring interview.

Options absent from Forge's documented list are rejected. Eval's native `--report` argument contract is not specified in the upstream reference; use the installed `claude plugin eval --help` and invoke Claude directly for that flag. Forge's `--json` controls its own response envelope; `--native-json` and `--native-json-output` control native eval output. See the reference for each operation's minimum Claude version.

The native-file workflows work without Claude installed. Repository tests use fixture executables to verify argument routing, output handling and failures; they do not verify a real Claude installation or execute your authored hooks/plugins.
