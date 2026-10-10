# docker-agent definitions and Claude Code generation

[Research index](README.md) · Researched 2026-10-10

The Forge manages agent definitions as [docker-agent](https://github.com/docker/docker-agent) YAML files and generates Claude Code agents from them. This page records two contracts:
- the docker-agent format, at commit `cd65d7c`;
- the Claude Code artifacts generated from it, according to the code.claude.com documentation as of October 2026.

It also gives the mapping between them. *Unverified* marks statements not confirmed against a source.

## docker-agent format

### Version handling and strictness
- **Schema.** `agent-schema.json` is a JSON Schema draft-07 with `$id` `https://github.com/docker/docker-agent/blob/main/agent-schema.json`. It describes config "v16".
  - `version` is a string enum `"0"` to `"16"` and defaults to `"16"` when absent.
  - The root requires `agents`.
  - The root and every nested definition use `additionalProperties: false`.
- **Loader** (`pkg/config`):
  1. Applies flavors (JSON Merge Patch overlays).
  2. Parses with the per-version parser, in strict mode, so unknown keys are fatal.
  3. Upgrades the result through a chain of versions. Only v0 to v1 changes the structure: `type` becomes `provider`, and the `todo`, `think` and `memory` flags become toolsets.
- **Examples** do not declare `version`. An HCL syntax also exists.

### Top-level keys

| Key | Shape |
| --- | --- |
| `version` | string `"0"`–`"16"`, optional |
| `agents` | ordered map name → agent, at least one entry. The default agent is `root` if present, otherwise the first entry |
| `models` | map name → model config |
| `providers` | shared provider defaults |
| `mcps`, `rag`, `toolsets` | reusable definitions, referenced with `ref`, `use_toolsets` and similar |
| `commands`, `skills` | reusable groups, pulled in with `use_commands` / `use_skills` |
| `metadata` | `author`, `license`, `readme`, `description`, `version` (OCI publishing), `tags` |
| `permissions` | `allow` / `ask` / `deny` patterns such as `shell:cmd=rm *` and `read_*` |
| `runtime`, `budget`, `budgets`, `flavors`, `evaluators` | sandbox, safety, budgets, overlays and assessors |

### Agent object
- **Prompt and identity:**
  - `model` (required unless `harness` is set), `description`
  - `instruction` (string or list, joined with blank lines), `instruction_file` (relative paths, no `..`; mutually exclusive with `instruction`)
  - `welcome_message`
  - `add_date`, `add_environment_info`, `add_prompt_files`, `add_prompt_files_depth`
- **Multi-agent:**
  - `sub_agents` (local names or OCI references; enables the `transfer_task` tool)
  - `handoffs` and `force_handoff` (`force_handoff` must not form a cycle)
  - `routing`
  - `harness` (`claude-code|codex|opencode|pi`, with `model`, `effort`, `agent`, `thinking`)
- **Tools:**
  - `toolsets`, `use_toolsets`, `readonly`, `code_mode_tools`
  - `skills`, `use_skills`, `commands`, `use_commands`
- **Limits:**
  - `max_iterations`, `max_consecutive_tool_calls`
  - history and token limits, compaction settings
  - `budgets`, `fallback`
- **Other:** `structured_output`, `hooks` (about 30 events), `cache`, `safety`, `redact_secrets`.
- **Templating.** Prompt and command fields use a JavaScript template evaluator: `${env.X}`, `${env.X || 'd'}`, ternaries and `${tool({...})}`. Commands also get `${args[i]}` and `${args}`.
- **Validation rules:**
  - At least one agent exists.
  - Every agent reference resolves to a local agent or an external reference.
  - External reference names don't collide with local agents.
  - Models resolve to a `models` key, an inline `provider/model`, `auto`, or a comma-separated "alloy" list.

### Models and toolsets
- **Models:**
  - Required: `provider` and `model`, unless `first_available` is used.
  - Sampling: `temperature`, `max_tokens`, `top_p` and penalties.
  - Endpoint and auth: `base_url`, `token_key`, `auth`.
  - Reasoning: `thinking_budget`, either an integer or a level (`none|minimal|low|medium|high|xhigh|max|adaptive[/effort]`).
  - Also `routing`, `capabilities` and `cost`.
  - About 30 providers are supported. An inline reference has the form `anthropic/claude-sonnet-4-5`.
- **Toolset types:**
  - Built-in tools: `filesystem`, `file`, `shell`, `fetch`, `think`, `todo`, `tasks`, `plan`, `memory`, `user_prompt`, `calculator`, `random`, `datetime`, `environment`, `git`
  - Protocol and network: `mcp`, `mcp_catalog`, `lsp`, `api`, `openapi`, `a2a`, `open_url`, `webhook`, `rag`
  - Scripts and jobs: `script`, `background_jobs`, `background_agents`, `scheduler`
  - Other: `session_context`, `model_picker`
- **Required fields by type:**
  - `mcp`: one of `command`, `remote.url` or `ref` (`docker:<name>` starts the Docker MCP Gateway)
  - `lsp`: `command`
  - `api`: `api_config`
  - `a2a`, `openapi`, `open_url`: `url`
- **Shared toolset fields:** `instruction`, `tools` (allow filter), `readonly`, `defer`, `env`, `args`, `working_dir`, `lifecycle`.

## Claude Code artifacts
- **Subagent file** `.claude/agents/<name>.md`, Markdown with frontmatter:
  - **Required:** `name` (at most 256 characters, no `:`) and `description`.
  - **Optional:**
    - `tools`, `disallowedTools`
    - `model` (`sonnet|opus|haiku|fable`, a full model id, or `inherit`)
    - `permissionMode`, `maxTurns`, `skills` (preloaded)
    - `mcpServers` (names, or inline `{name: {type: stdio|http|sse|ws, …}}`)
    - `hooks`, `memory` (`user|project|local`), `background`, `isolation: worktree`
    - `effort`, `color`, `initialPrompt`, `omitClaudeMd`, `experimental.cacheTtl`
  - **Unknown fields** are ignored by Claude Code and preserved by Forge.
  - **Precedence and plugins:** project agents override user agents. Plugin agents ignore `permissionMode`, `mcpServers`, `hooks` and `initialPrompt`.
- **Tool names:**
  - `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `WebFetch`, `WebSearch`
  - `Agent(name)` (an allowlist that only applies when the agent runs as the main thread)
  - `Task*`, `AskUserQuestion`, `LSP`, `mcp__<server>__<tool>`
- **`.mcp.json`:** `{"mcpServers": {name: {type, command, args, env | url, headers, oauth}}}`, with `${VAR}` and `${VAR:-default}` expansion.
- **Skills:** `.claude/skills/<name>/SKILL.md`, with `$ARGUMENTS`, `$0`… (0-based) and `context: fork` + `agent`.
- **Permissions:** project `.claude/settings.json` has `permissions.allow|ask|deny`, with rules such as `Bash(git diff*)` and `WebFetch(domain:…)`.

## Mapping

Fidelity: E means exact, A means approximate (emitted with a warning diagnostic), and U means unsupported (not emitted, recorded as a diagnostic).

| docker-agent | Claude artifact | Fidelity |
| --- | --- | --- |
| `agents.<name>` | `.claude/agents/<name>.md`; the name is sanitized | E |
| Root or default agent | Same file; optionally the project setting `"agent": "<root>"` | A |
| `description` | `description`; synthesized with a warning if missing | E/A |
| `instruction`, `instruction_file` | Markdown body; lists joined with blank lines; files inlined | E |
| `${env…}` / `${tool(…)}` templates | Kept literally with a warning (expansion is opt-in) | U/A |
| `add_date`, `add_environment_info`, `add_prompt_files`, `welcome_message` | Not emitted; info diagnostics | A/U |
| Model `anthropic/<id>` or named Anthropic model | `model: <id>`, or an alias by option | E/A |
| Non-Anthropic model, `auto`, alloy, `first_available` | First Anthropic candidate, otherwise `inherit`, with a warning | A |
| Sampling, endpoint, provider, fallback and cost settings | Not emitted | U |
| `thinking_budget` level | `effort` | A |
| `sub_agents` (local) | One file per sub-agent, plus `Agent(x)` in the parent's `tools` when `tools` is emitted | A |
| `handoffs`, `force_handoff`, `routing`, external OCI sub-agents | Not emitted (delegation is opt-in) | U |
| `max_iterations` | `maxTurns` (0 means omitted) | A |
| `readonly` | Read-only tool set, plus `disallowedTools: Write, Edit, NotebookEdit` | A |
| `filesystem` | `Read, Write, Edit, Glob, Grep`. `deny_list` becomes deny rules with `--settings`. `allow_list` restricts access in docker-agent, so it never becomes an allow rule; it produces a diagnostic instead | A |
| `shell` | `Bash` | E |
| `fetch` | `WebFetch`. `blocked_domains` becomes deny rules with `--settings`. `allowed_domains` never becomes allow rules; it produces a diagnostic | E/A |
| `todo`, `tasks` | `TaskCreate, TaskGet, TaskList, TaskUpdate` | A |
| `memory` | `memory: project` | A |
| `user_prompt` | `AskUserQuestion` | A |
| `think` | Not emitted (use `effort`) | A |
| `mcp` stdio | Opt-in only: `--mcp inline` writes `mcpServers`, `--mcp project` merges into `.mcp.json`. The default `--mcp none` writes no servers and no `mcp__` grants. Each written command gets an `executes-command` diagnostic. `${env.X}` becomes `${X}` | E/A |
| `mcp` remote | `type: http` (streamable) or `sse`, `url`, `headers`, mapped `oauth` fields | E |
| `mcp` `ref: docker:<name>` | stdio `docker mcp gateway run --servers <name>` | A |
| `script`, `api`, `openapi`, `a2a`, `rag`, `webhook`, `scheduler`, `lsp`, other toolsets | Not emitted, with diagnostics | U |
| `commands` | `.claude/skills/<n>/SKILL.md`; `${args[i]}` becomes `$i`, `${args}` becomes `$ARGUMENTS` | A |
| `skills` | `skills:` frontmatter (preloaded) | A |
| `hooks` with a Claude equivalent | Frontmatter `hooks` with translated tool matchers, written only with `--hooks`. Each command gets an `executes-command` diagnostic | A |
| Top-level `permissions` | Project `settings.json` permissions, written only with `--settings`. A narrow permission is never widened. Broad allow rules require `--allow-broad-permissions`. Each rule gets a `grants-permission` diagnostic | A |
| `harness: claude-code` | `model` and `effort` from the harness | A |
| Compaction, cache, budgets, flavors, evaluators, metadata, runtime | Not emitted | U |

## Design consequences for Forge
- **Source of truth.** The docker-agent YAML file is the source of truth and is stored verbatim, comments included. Forge validates it against a vendored `agent-schema.json`, pinned to the conforming docker-agent version, and then applies docker-agent's semantic checks. It accepts files whose `version` is absent or `"16"`; older versions get a diagnostic.
- **Generation** is a pure function from config to `{files, diagnostics}`. Each diagnostic records `severity`, `code`, a JSON pointer, `fidelity` and a message.
  - Written through the existing guarded write path, with dry runs, revisions and `vault.*` events.
  - Anything that runs code (hooks, MCP server commands) or grants permissions is opt-in and listed as an explicit diagnostic before it is written.
  - `.mcp.json` and settings changes are opt-in and merged into the existing files. Forge only replaces entries it owns, as recorded in `.claude/forge-generated.json`; any other entry with the same name is a conflict.
  - Generated agent files carry `x-forge-source: {path, agent, sourceHash, optionsHash, outputHash}` provenance, which Claude Code ignores. `sourceHash` covers the YAML and its instruction files. Forge uses the hashes to tell a changed source or option apart from a hand edit.
- **Round trips.** docker-agent → Claude → docker-agent is lossy by design. A lossless re-import is possible only from the preserved source. Importing a hand-written Claude agent into docker-agent YAML is feasible but approximate, and every concept that cannot be represented gets a diagnostic.
