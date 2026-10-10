---
name: forge-agents
description: Maintain docker-agent agent definitions in agents/*.yaml and generate, check and import Claude Code agents from them.
---

Agent definitions are [docker-agent](https://github.com/docker/docker-agent) YAML files in the scope's `agents/` folder (`plugins.settings.agents.directory`). One file is a team: `agents.<name>` entries with `model`, `description`, `instruction`, `toolsets`, `sub_agents` and `commands`, plus shared `models`, `mcps` and `toolsets`. The YAML file is the source of truth; generated `.claude/agents/*.md` files are outputs. Never edit a generated agent by hand: change the definition and regenerate.

Inspect before changing anything:
- `agents list` returns each file's `revision`, `agents` (`name`, `description`, `model`, `subAgents`), `default` agent (`root`, else the first) and error/warning counts.
- `agents inspect team.yaml` returns the parsed `config` and `diagnostics`; `agents inspect team.yaml#reviewer` returns one agent's `definition` and resolved `instruction`.
- `agents validate [team.yaml]` checks the vendored docker-agent JSON Schema and docker-agent's semantic rules (references, models, toolsets, `force_handoff` cycles, `instruction` vs `instruction_file`, version `"16"` or absent). Errors fail with `INVALID_AGENT_DEFINITION`; `details.files[].diagnostics` give `severity`, `code`, JSON `pointer`, 1-based `line`/`column` and `message`.

Author agents:
- `agents create reviewer --file team.yaml --description "Reviews changes" --instruction "..." --toolset filesystem,shell --if-match <revision> --dry-run` adds an agent to an existing team file without touching its other lines or comments; omit `--if-match` for a new file. `--model` defaults to `plugins.settings.agents.defaultModel`. MCP, LSP, API and similar toolsets need settings: edit the YAML with `edit team.yaml --find … --replace … --if-match <revision>`, then `agents validate`.
- `agents import code-reviewer --from claude --file team.yaml` converts `.claude/agents/code-reviewer.md` into a docker-agent agent. The conversion is approximate: read every diagnostic (`fidelity` `A` approximated, `U` dropped) and fix the YAML.

Generate Claude Code agents:
- `agents generate --target claude --plan` reports every output with `status` `missing`, `changed`, `hand-edited` or `unchanged` and the mapping `diagnostics` (each with `fidelity` and a JSON `pointer` into the definition). Review warnings: models other than Anthropic become `inherit`, unsupported toolsets, hooks and delegation settings are dropped.
- `agents generate --target claude` writes new files. Existing outputs are never overwritten silently: run `--plan-out review.json`, review, then `--revisions-from review.json`.
- `--mcp project` merges MCP servers into `.mcp.json` instead of inlining them; `--settings` merges permission rules and the main agent into `.claude/settings.json`; `--commands` writes `/commands` as `.claude/skills/<name>/SKILL.md`; `--model-style alias` emits `sonnet`/`opus`/`haiku`. Merges keep unrelated servers, rules and settings. Pass the same options to `--check`.
- `agents generate --target claude --check` exits 5 with `AGENT_DRIFT` when outputs are `missing`, `changed` (definition changed), `hand-edited` (output edited since generation) or `stale` (generated from a definition that no longer defines it). Run it in CI after changing definitions.

Generated files carry `x-forge-source: {path, sha256, agent}` provenance and pass Forge's Claude agent validation (`claude agents inspect <name>`). A docker-agent → Claude → docker-agent round trip is lossy; the YAML file keeps everything Claude cannot represent.
