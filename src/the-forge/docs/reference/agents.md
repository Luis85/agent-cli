# Agents

[Documentation](../index.md) · Reference

`agents` manages agent definitions written in the [docker-agent](https://github.com/docker/docker-agent) YAML format and generates Claude Code agents from them. The definition files are the source of truth; generated `.claude/agents/<name>.md` files are outputs. The command is contributed by the `agents` [core plugin](plugins.md#bundled-core-plugins) (`src/plugins/agents/` in the Forge source), enabled by default; `plugins.disabled: ["agents"]` removes it. For a walkthrough, see [manage agent definitions](../how-to/manage-agents.md).

```sh
node bin/forge.js agents list
node bin/forge.js agents validate
node bin/forge.js agents create reviewer --file team.yaml --toolset filesystem,shell --if-match <revision>
node bin/forge.js agents import code-reviewer --from claude --file team.yaml
node bin/forge.js agents generate --target claude --plan
node bin/forge.js agents generate --target claude --check
```

## Definition files

Definitions live directly in the scope's definitions folder, `agents/` by default (`plugins.settings.agents.directory`), as `*.yaml` or `*.yml`; subfolders are not scanned. One file is a team, exactly as in docker-agent: `agents.<name>` entries plus shared `models`, `providers`, `mcps`, `rag`, `toolsets`, `commands`, `skills` and `permissions`. The default agent is `root` when present, otherwise the first agent. Forge stores the files as written: it never reformats them, and `agents create` and `agents import` add an agent by inserting its text after the last agent, so every other line and comment stays byte for byte.

A `<file>` argument is a file name in the definitions folder (`team.yaml`), or, when it contains `/`, a path relative to the scope (`agents/team.yaml`). `instruction_file` paths resolve relative to the definition file and must stay inside the scope.

| Setting | Default | Meaning |
| --- | --- | --- |
| `plugins.settings.agents.directory` | `agents` | Scope-relative folder of definition files |
| `plugins.settings.agents.defaultModel` | `anthropic/claude-sonnet-5` | Model of `agents create` without `--model`, and of imported agents whose Claude model cannot be mapped |

### Validation

Validation runs in three stages and reports every finding at once:

1. **YAML.** The file must be UTF-8 YAML; YAML 1.1 merge keys (`<<`) and anchors are supported, duplicate keys are errors (`yaml-syntax`).
2. **Schema.** The document must match docker-agent's `agent-schema.json` (JSON Schema draft-07, configuration version 16, unknown keys rejected everywhere). Forge vendors the schema pinned to docker-agent commit `cd65d7c` and validates with [Ajv](https://ajv.js.org/); `format: uri` values must be absolute URIs (`schema`).
3. **Semantics.** Forge ports docker-agent's load-time checks from `pkg/config` at the same commit:
   - `version` is absent or `"16"`; any other version is an `unsupported-version` error. Forge never migrates older files; docker-agent itself upgrades them when it loads them.
   - `sub_agents`, `handoffs` and `force_handoff` name local agents or external references (OCI references and URLs, optionally `name:ref`), and an external reference's derived name must not clash with a local agent (`unknown-agent-reference`, `external-agent-conflict`).
   - `force_handoff` never targets the agent itself and never forms a cycle (`force-handoff-self`, `force-handoff-cycle`).
   - `instruction` and `instruction_file` are mutually exclusive, instruction files are local relative paths, and they must exist (`instruction-conflict`, `invalid-instruction-file`, `instruction-file-missing`).
   - Models resolve to a `models` key, an inline `provider/model`, `auto`, or a comma-separated alloy list, recursively; routing rules and RAG strategies too (`unknown-model`). `first_available` selectors stand alone and `compaction_threshold` lies in (0, 1] (`invalid-model`).
   - `use_toolsets`, `use_commands`, `use_skills`, MCP `ref`s to `mcps` entries (others must start with `docker:`), RAG `ref`s, budgets and inline fork-skill toolsets resolve (`unknown-toolset`, `unknown-command-group`, `unknown-skill-group`, `unknown-mcp-definition`, `invalid-mcp-definition`, `unknown-rag-definition`, `unknown-budget`).
   - Toolset fields match their type (for example `path` only on `memory` and `tasks`), each type has its required source (`mcp`: exactly one of `command`, `remote.url` or `ref`; `lsp`: `command`; `a2a`, `openapi`, `open_url`: `url`), domain patterns and OAuth settings are valid (`invalid-toolset`). Providers, harness options and inline skills follow docker-agent's rules (`invalid-provider`, `invalid-harness`, `invalid-skills`).

The conformance suite validates every `examples/*.yaml` of the pinned docker-agent commit without errors. Refresh the vendored schema, its license and the conformance fixtures from a docker-agent checkout with `npm run vendor:docker-agent -- <checkout>` in `src/the-forge`; the distribution's `THIRD-PARTY-NOTICES.md` names the vendored commit and ships docker-agent's Apache-2.0 license.

### Diagnostics

Every finding is a diagnostic:

```json
{ "severity": "error", "code": "unknown-model", "pointer": "/agents/root/model", "line": 3, "column": 12, "message": "agent 'root' references non-existent model 'nowhere'." }
```

`pointer` is an RFC 6901 JSON pointer into the parsed definition (`~1` escapes `/`); `line` and `column` are 1-based positions of the pointed value in the YAML, or of its nearest existing parent when the value is missing. Generation and import diagnostics add `fidelity` (see [the mapping](#mapping-to-claude-code)) and `path`, the file the pointer refers to. `severity` is `error` (the file is invalid), `warning` (approximated or dropped behavior you should review) or `info` (settings without a Claude equivalent that change nothing you rely on).

## Commands

| Action | Result |
| --- | --- |
| `agents [list]` | `{directory, files}`; each file has `path`, `revision`, `valid`, `version` when declared, `default`, `agents` (`name`, `description`, `model`, `subAgents`) and `errors`/`warnings` counts. Never fails on invalid files |
| `agents inspect <file>` | `{path, revision, valid, default, config, diagnostics}` with the parsed document (`config` is `null` when the YAML does not parse) |
| `agents inspect <file>#<agent>` | `{path, revision, agent, default, definition, instruction?, diagnostics}`; `instruction` is the resolved `instruction_file` text. An unknown agent is `AGENT_NOT_FOUND` |
| `agents validate [file]` | `{directory, valid: true, files: [{path, revision, valid, diagnostics}]}` for one or every file. Any error fails with `INVALID_AGENT_DEFINITION` and `details.files[].diagnostics` |
| `agents create <name>` | Adds an agent and returns `{path, agent, created, diagnostics, dryRun, changes}` |
| `agents import <agent \| path.md> --from claude` | Converts a Claude agent and adds it like `create`; the result adds `from: {target, path, revision}` |
| `agents generate --target claude` | Generates Claude Code files; see [generation](#generation) |

`agents create <name> [--file team.yaml] [--model ref] [--description text] [--instruction text] [--toolset types] [--if-match sha256]` writes a valid docker-agent agent: `model` (default `defaultModel`), `description` (default `The <name> agent.`), `instruction` (default the description) and one toolset per `--toolset` type. `--toolset` accepts types without required settings: `filesystem`, `shell`, `fetch`, `think`, `todo`, `tasks`, `memory`, `user_prompt`, `calculator`, `random`, `datetime`, `environment`, `git`, `plan`, `session_context`, `background_jobs`, `background_agents`, `scheduler`, `mcp_catalog` and `file`; add `mcp`, `lsp`, `api` and other toolsets by editing the YAML. Names start with a letter or digit and contain letters, digits, `-` and `_` (`INVALID_NAME`). `--file` defaults to `<name>.yaml`. A new file starts with a header comment and `version: "16"`; adding to an existing file requires its current revision with `--if-match` (`CONFLICT` otherwise, with `details.currentRevision`) and an agent name the file does not define (`AGENT_EXISTS`). The result is validated before it is written: a file that would become invalid is refused with `INVALID_AGENT_DEFINITION`. Dry runs return the write's unified `diff`.

`agents import <agent> --from claude [--file team.yaml] [--if-match sha256]` reads `.claude/agents/<agent>.md` (or a `.md` path), validates it like `claude agents inspect`, and adds the converted agent to `--file` (default `<name>.yaml`). The conversion is approximate; see [importing Claude agents](#importing-claude-agents).

## Generation

`agents generate --target claude [--file team.yaml] [--agent name] [--mcp inline|project] [--settings] [--commands] [--model-style id|alias] [--plan | --plan-out path.json | --check | --revisions-from path.json]` generates from every definition file, or from `--file`; `--agent` generates one agent of them. Any invalid definition stops generation with `INVALID_AGENT_DEFINITION`, as do two agents whose sanitized names collide (`agent-name-collision`). Generation is a pure function of the definitions and options, so the same input always produces the same bytes.

| Output | When | Content |
| --- | --- | --- |
| `.claude/agents/<name>.md` | Always, per agent | Frontmatter from the mapping, the instruction as the body and `x-forge-source: {path, sha256, agent}` provenance (the definition file, its revision and the docker-agent agent name). Each file passes Forge's Claude agent validation |
| `.claude/skills/<name>/SKILL.md` | `--commands` | One skill per agent command, with `x-forge-source: {path, sha256, agent, command}` |
| `.mcp.json` | `--mcp project` and MCP toolsets | The generated servers set under `mcpServers` by name; other servers and keys stay |
| `.claude/settings.json` | `--settings` | Permission rules appended to `permissions.allow`/`ask`/`deny` where missing, and `"agent": "<default agent>"` when one definition file is generated; other settings stay |

The result is `{target, agents: [{agent, name, path, source}], skills, files: [{path, status}], stale, diagnostics, …}`. Each output's `status` is:

| Status | Meaning |
| --- | --- |
| `missing` | The file does not exist yet |
| `unchanged` | The file already has the generated bytes |
| `changed` | The file differs and its provenance names an older definition revision: the definition changed |
| `hand-edited` | The file differs although its provenance matches the current definition, or it has no provenance: someone edited the output or it was written by hand |

`stale` lists `.claude/agents/*.md` and `.claude/skills/*/SKILL.md` files whose provenance names a generated definition file that no longer produces them, such as a removed agent. Forge never deletes them; remove them with `delete` after review. `--agent` skips the stale scan.

Review and writes follow the shared generation pattern of `make ui`:

- `--plan` writes nothing and adds `{plan: true, matches, revisions, outputs}` with each output's `content` (and `currentContent` when it differs); `--plan-out review.json` also writes the revision manifest.
- Without a review option, generation writes only `missing` outputs (and nothing for `unchanged` ones). Changing an existing file needs its approved revision: run `--plan-out review.json`, review, then `--revisions-from review.json`. Otherwise the write fails with `CONFLICT`, so hand edits are never overwritten silently.
- `--check` writes nothing and succeeds with `{check: true, matches: true}`, or fails with exit 5 and `AGENT_DRIFT`, whose `details` hold `outputs: [{path, status}]` (every output that is not `unchanged`) and `stale`. Pass the same `--mcp`, `--settings`, `--commands` and `--model-style` options as the generation you check.
- `--dry-run` previews the writes with `preview` contents and publishes `workspace.quick-preview` records.

A committed generation publishes `vault.create`/`vault.modify` for each written file and then `agents.generated` with `{target: "claude", sources, agents, files}` (the written paths); see [events](plugins.md#host-events-and-correlation). `--events all` includes it in the response.

## Mapping to Claude Code

Fidelity **E** is exact; **A** is approximate and emitted with a warning diagnostic; **U** is unsupported, not emitted, and recorded as a diagnostic (a warning when behavior is lost, otherwise info). The codes in the last column appear in `diagnostics`.

| docker-agent | Claude Code artifact | Fidelity | Diagnostic codes |
| --- | --- | --- | --- |
| `agents.<name>` | `.claude/agents/<name>.md`; the name is lowercased and runs of other characters than `a-z0-9-` become `-` | E | `name-sanitized` (info) when it changes |
| Default agent (`root`, else the first) | Same file; with `--settings` also `"agent": "<name>"` in `.claude/settings.json` | A | `main-agent-approximated` |
| `description` | `description`; synthesized as `The <name> agent.` when missing | E/A | `description-synthesized` |
| `instruction` (string or list), `instruction_file` | Markdown body; list items and files joined with a blank line | E | — |
| `${env.X}` and other `${…}` templates in prompts and descriptions | Kept literally | A (`env`)/U | `template-literal` |
| `add_date`, `add_environment_info` | Not emitted; Claude Code adds both to its system prompt | A | `prompt-option-approximated` (info) |
| `add_prompt_files`, `add_prompt_files_depth`, `welcome_message` | Not emitted | U | `prompt-option-unsupported` |
| Model `anthropic/<id>`, or a named model whose provider (or custom provider type) is `anthropic` | `model: <id>`; `--model-style alias` emits `opus`, `sonnet`, `haiku` or `fable` | E/A | `model-alias` with aliases |
| `auto`, alloys, `first_available`, other providers, no model | First Anthropic candidate in order, otherwise `model: inherit` | A | `model-approximated` |
| Sampling, endpoint, auth, routing, cost and other settings of the chosen model | Not emitted | U | `model-setting-unsupported` (info) |
| `thinking_budget` of the chosen model | `effort`: levels map by name, `adaptive` → `high`, `adaptive/<level>` → level, token budgets ≤4,096 → `low`, ≤16,384 → `medium`, else `high`; `none`, `minimal` and 0 emit nothing | A | `effort-approximated` |
| `harness: claude-code` | `model` and `effort` from the harness | A | `harness-approximated` |
| Other harnesses | `model: inherit` | U | `harness-unsupported` |
| Local `sub_agents` | One file per sub-agent, plus `Agent(<name>)` in the parent's `tools` | A | `delegation-approximated` |
| External `sub_agents`, `handoffs`, `force_handoff`, `routing` | Not emitted | U | `delegation-unsupported` |
| `max_iterations` | `maxTurns` (0 is omitted) | A | `max-iterations-approximated` |
| `readonly` | Read-only file tools, no `Bash`, and `disallowedTools: Write, Edit, NotebookEdit` | A | `readonly-approximated` |
| `filesystem` toolset | `Read, Write, Edit, Glob, Grep` (`Read, Glob, Grep` when read-only); `allow_list`/`deny_list` become `Read(<path>/**)` and `Edit(<path>/**)` rules with `--settings` | A | `toolset-approximated`, `permission-approximated` |
| `shell` | `Bash` | E | — |
| `fetch` | `WebFetch`; `allowed_domains`/`blocked_domains` become `WebFetch(domain:…)` allow/deny rules with `--settings` (CIDR ranges are dropped) | E/A | `permission-approximated` |
| `todo`, `tasks` | `TaskCreate, TaskGet, TaskList, TaskUpdate` | A | `toolset-approximated` |
| `memory` | `memory: project` | A | `toolset-approximated` |
| `user_prompt` | `AskUserQuestion` | A | `toolset-approximated` |
| `think` | Not emitted; use `effort` | A | `toolset-approximated` |
| Toolset `tools` filter on built-in toolsets | The matching Claude tools only | A | `tool-filter` |
| `mcp` with `command` | Inline `mcpServers` entry `{type: stdio, command, args, env}` (default), or a `.mcp.json` server with `--mcp project` and its name in `mcpServers`; `mcp__<server>__<tool>` per `tools` entry, else `mcp__<server>__*`. `${env.X}` → `${X}`, `${env.X \|\| 'd'}` → `${X:-d}`, `${X}` stays | E/A | `template-literal` for other expressions |
| `mcp` with `remote` | `type: http` (streamable) or `sse`, `url`, `headers`, and `oauth.clientId`/`callbackPort` | E | `mcp-oauth-unsupported` for `clientSecret`, `scopes`, `callbackRedirectURL` |
| `mcp` with `ref: docker:<name>` | stdio `docker mcp gateway run --servers <name>` | A | `mcp-docker-gateway` |
| `mcp` `ref` to an `mcps` definition | The definition merged with the toolset's own fields, named after the definition | E | — |
| MCP `version`, `working_dir`, `lifecycle`, `allow_private_ips`, `config`; toolset `instruction`, `defer`, `timeout`, `env` on non-MCP toolsets, and similar | Not emitted | U | `toolset-field-unsupported` (info) |
| `mcp_catalog`, `script`, `api`, `openapi`, `a2a`, `rag`, `webhook`, `scheduler`, `lsp`, `file`, `git` and every other toolset | Not emitted | U | `toolset-unsupported` |
| No toolset with a Claude tool and no local sub-agent | `tools` is omitted, so the Claude agent inherits every tool | A | `tools-inherited` |
| `commands` and `use_commands` (with `--commands`) | `.claude/skills/<command>/SKILL.md` with `disable-model-invocation: true`; `${args[i]}` → `$i`, `${args}` and `${args.join(" ")}` → `$ARGUMENTS`. A command with `agent` becomes `context: fork` + `agent: <name>` (body `$ARGUMENTS` without an instruction). Identical commands of several agents share one skill; different ones are prefixed with their agent | A | `command-approximated`, `command-renamed`, `template-literal`, `description-synthesized` |
| `url` commands | Not emitted | U | `command-unsupported` |
| `commands` without `--commands` | Not emitted | U | `commands-not-generated` (info) |
| `skills` names | `skills:` frontmatter (preloaded) | A | `skills-approximated` |
| `skills: true/false`, skill sources, inline skills | Not emitted | A/U | `skills-approximated` (info), `skills-unsupported` |
| `hooks` events with a Claude equivalent: `pre_tool_use`, `post_tool_use`, `permission_request`, `session_start`, `user_prompt_submit`, `session_end`, `pre_compact`/`before_compaction`, `after_compaction`, `subagent_stop`, `stop`, `notification`, `worktree_create` | Frontmatter `hooks` with `PreToolUse`, `PostToolUse`, …; `command` hooks keep `command`, `args` and `timeout`; tool matchers translate tool names (`shell` → `Bash`, `edit_file` → `Edit`, …) | A | `hook-approximated`, `hook-matcher-approximated`, `hook-field-unsupported` |
| Other hook events, `builtin` and `model` hooks | Not emitted | U | `hook-unsupported` |
| Top-level `permissions` (with `--settings`) | `.claude/settings.json` rules: `shell:cmd=<glob>` → `Bash(<glob>)`, `mcp:<server>:<tool>` → `mcp__<server>__<tool>` (`*` → `mcp__<server>`), built-in tool names and globs → Claude tools | A | `permission-approximated`, `permission-unsupported` |
| Top-level `permissions` without `--settings` | Not emitted | U | `permissions-not-generated` (info) |
| `fallback`, compaction, `cache`, `budgets`, `safety`, `redact_secrets`, `structured_output`, history and token limits | Not emitted | U | `setting-unsupported` (info) |
| Top-level `metadata`, `runtime`, `budget`, `budgets`, `flavors`, `evaluators`, `providers` | Not emitted | U | `setting-unsupported` (info) |

Diagnostics are reported once per definition file, pointer, code and message, so a shared model or toolset appears once. A docker-agent → Claude → docker-agent round trip is lossy by design: edit the definition, never the generated file.

## Importing Claude agents

`agents import --from claude` reverses the mapping where it can. Every diagnostic `pointer` refers to the Claude agent's frontmatter and `path` names the Markdown file.

| Claude Code | docker-agent | Fidelity | Diagnostic codes |
| --- | --- | --- | --- |
| `name` | Agent name; characters other than letters, digits, `-` and `_` become `-` | E | `name-sanitized` |
| `description`, body | `description`, `instruction` | E | — |
| `model: claude-…` | `anthropic/claude-…` | E | — |
| `model: opus/sonnet/haiku/fable` | The newest model of that family used by the pinned docker-agent examples (`anthropic/claude-opus-5`, `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4-5`, `anthropic/claude-fable-5-1`) | A | `model-approximated` |
| `model: inherit`, omitted or other | `plugins.settings.agents.defaultModel` | A | `model-approximated` |
| `Read`, `Glob`, `Grep`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | `filesystem`, read-only (`readonly: true`) unless a writing tool is granted and not in `disallowedTools` | A | `toolset-approximated` |
| `Bash`, `WebFetch` | `shell`, `fetch` | E | — |
| `Task*`, `TodoWrite`, `AskUserQuestion` | `todo`, `user_prompt` | A | `toolset-approximated` |
| `Agent(<name>)` | `sub_agents` when the target file defines `<name>`; otherwise dropped | A/U | `delegation-approximated`, `delegation-unsupported` |
| Inline `mcpServers` (stdio, http, sse) | `mcp` toolsets with `command`/`args`/`env` or `remote`; `mcp__<server>__<tool>` grants become the toolset's `tools` | E | — |
| `mcpServers` names and `ws` servers | Not imported | U | `mcp-reference-unsupported`, `mcp-transport-unsupported` |
| `tools` omitted | `filesystem`, `shell`, `fetch`, `todo` and `user_prompt` | A | `tools-inherited` |
| `WebSearch`, `LSP` and other tools | Not imported | U | `tool-unsupported` |
| `maxTurns`, `skills`, `memory` | `max_iterations`, `skills`, a `memory` toolset | A | `max-iterations-approximated`, `skills-approximated`, `toolset-approximated` |
| `hooks` command hooks | `hooks` with docker-agent event names and tool names in matchers | A | `hook-approximated`, `hook-unsupported` |
| `permissionMode`, `background`, `isolation`, `color`, `initialPrompt`, `omitClaudeMd`, `effort`, `experimental`, unknown fields | Not imported | U | `field-unsupported` |
| `x-forge-source` | Not imported: the agent was generated, so edit its definition instead | A | `generated-agent` |

## Errors

| Code | Exit | When |
| --- | --- | --- |
| `INVALID_AGENT_DEFINITION` | 2 | A definition fails validation (`details.files[].diagnostics`), a create or import would leave the file invalid, or generated names collide (`details.diagnostics`) |
| `AGENT_NOT_FOUND` | 3 | `inspect <file>#<agent>` or `generate --agent` names an agent no definition defines |
| `AGENT_EXISTS` | 2 | `create` or `import` names an agent the target file already defines |
| `AGENT_DRIFT` | 5 | `generate --check` found missing, changed, hand-edited or stale outputs |

Commands also report `NOT_FOUND`, `CONFLICT` (stale `--if-match`, or regenerating existing outputs without approved revisions), `INVALID_NAME`, `INVALID_YAML`, `INVALID_CLAUDE_AGENT` (an imported agent or generated frontmatter), `INVALID_CLAUDE_SETTINGS` (an unparsable `.mcp.json` or `.claude/settings.json` to merge into), `INVALID_GENERATION_PLAN` and `INVALID_GENERATION_REVISIONS`; see the [error catalog](errors.md).

## Limits

- Forge validates and generates; it does not run docker-agent agents, resolve OCI references, expand templates or check that models, MCP servers or credentials exist.
- HCL definitions and flavors are not read; generation uses the file as written.
- Generated agents and skills target Claude Code's project scope (`.claude/` in the command scope). Structural validation does not prove that Claude Code accepts every generated hook, permission rule or MCP server at runtime.
