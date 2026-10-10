---
name: forge-agents
description: Maintain docker-agent agent definitions in agents/*.yaml and generate, check and import Claude Code agents from them.
---

Agent definitions are [docker-agent](https://github.com/docker/docker-agent) YAML files in the scope's `agents/` folder (`plugins.settings.agents.directory`). One file is a team: `agents.<name>` entries with `model`, `description`, `instruction`, `toolsets`, `sub_agents` and `commands`, plus shared `models`, `mcps` and `toolsets`. The YAML file is the source of truth; generated `.claude/agents/*.md` files are outputs. Never edit a generated agent by hand: change the definition and regenerate.

Inspect before changing anything:
- `agents list` returns each file's `revision`, `agents` (`name`, `description`, `model`, `subAgents`), `default` agent (`root`, else the first) and error/warning counts.
- `agents inspect team.yaml` returns the parsed `config` and `diagnostics`; `agents inspect team.yaml#reviewer` returns one agent's `definition` and resolved `instruction`.
- `agents validate [team.yaml]` checks the vendored docker-agent JSON Schema and docker-agent's semantic rules (references, models, toolsets, `force_handoff` cycles, `instruction` vs `instruction_file`, version `"16"`, `16` or absent). `instruction_file` paths are relative to the definition file and must stay in its folder or below (`./prompt.md` and `prompts/../x.md` are fine, `../x.md` is not). Errors fail with `INVALID_AGENT_DEFINITION`; `details.files[].diagnostics` give `severity`, `code`, JSON `pointer`, 1-based `line`/`column` and `message`.

Author agents:
- `agents create reviewer --file team.yaml --description "Reviews changes" --instruction "..." --toolset filesystem,shell --if-match <revision> --dry-run` adds an agent to an existing team file without touching its other lines or comments; omit `--if-match` for a new file. `--model` defaults to `plugins.settings.agents.defaultModel`. `--from-template basic|team|mcp` starts from a bundled template instead of `--toolset` (`team` adds `<name>-researcher` and `<name>-writer`). MCP, LSP, API and similar toolsets need settings: edit the YAML with `edit agents/team.yaml --find … --replace … --if-match <revision>`, then `agents validate`.
- `agents import code-reviewer --from claude --file team.yaml` converts `.claude/agents/code-reviewer.md` into a docker-agent agent. The conversion is approximate: read every diagnostic (`fidelity` `A` approximated, `U` dropped) and fix the YAML.
- `create` and `import` write only `.yaml`/`.yml` files directly in the definitions folder; other paths fail with `INVALID_PATH`.

Generate Claude Code agents:
- `agents generate --target claude --plan` reports every output with `status` `missing`, `changed`, `hand-edited` or `unchanged` and the mapping `diagnostics` (each with `fidelity` and a JSON `pointer` into the definition). Review warnings: models other than Anthropic become `inherit`; unsupported toolsets, delegation settings and filesystem `allow_list`/fetch `allowed_domains` limits (`restriction-unsupported`) are dropped.
- `agents generate --target claude` writes new files. Existing outputs are never overwritten silently: run `--plan-out review.json`, review, then `--revisions-from review.json`.
- Nothing that runs commands or grants permissions is written without an opt-in: `--mcp inline` (agent frontmatter) or `--mcp project` (`.mcp.json`) writes MCP servers (default `--mcp none`, reported as `mcp-not-generated`); `--hooks` writes hooks (else `hooks-not-generated`); `--settings` merges permission rules and the main agent into `.claude/settings.json`, and allow rules for a whole tool (`Bash`, `Bash(*)`, `Edit`, `Write`, `WebFetch`, every tool of an MCP server) also need `--allow-broad-permissions` (else `broad-permission` errors). Before opting in, read every `executes-command` (full command line) and `grants-permission` (exact rule) diagnostic of the plan.
- `--commands` writes `/commands` as `.claude/skills/<name>/SKILL.md`; `--model-style alias` emits `sonnet`/`opus`/`haiku`/`fable`. Agents without a Claude tool get `tools: []`, never every tool.
- Merges change only entries Forge wrote, recorded in `.claude/forge-generated.json`, and keep the files' indentation and key order. A server name or main agent you set yourself fails with `AGENT_MERGE_CONFLICT`; `--rename-conflicts` (with `--mcp project`) gives the generated server a numbered name instead. Pass the same options to `--check`.
- `agents generate --target claude --check` exits 5 with `AGENT_DRIFT` when outputs are `missing`, `changed` (definition, instruction file or options changed), `hand-edited` (output no longer matches what Forge recorded) or `stale` (generated from a definition that no longer defines it). Run it in CI after changing definitions.

Generated files carry `x-forge-source: {path, agent, sourceHash, optionsHash, outputHash}` provenance and pass Forge's Claude agent validation (`claude agents inspect <name>`). A docker-agent → Claude → docker-agent round trip is lossy; the YAML file keeps everything Claude cannot represent.
