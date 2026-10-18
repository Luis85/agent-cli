---
name: forge-agents
description: Maintain docker-agent definitions in agents/*.yaml and validate, create, import and generate Claude Code agents, skills and MCP settings from them with drift checks. Use when editing agent teams, generating .claude/agents, or when agents validate or agents generate --check reports problems.
license: MIT
compatibility: Requires Node.js 22.12 or newer and The Forge distribution in the workspace bin folder.
metadata:
  author: The Forge
  version: "0.1.0"
---

Agent definitions are [docker-agent](https://github.com/docker/docker-agent) YAML files in the scope's `agents/` folder (`plugins.settings.agents.directory`). The YAML is the source of truth; generated `.claude/agents/*.md` files are outputs. Never edit a generated agent: change the definition and regenerate.

## Inspect
- `agents list` returns each file's `revision`, agents, `default` agent and error and warning counts.
- `agents inspect team.yaml` returns the parsed `config` and `diagnostics`; `agents inspect team.yaml#reviewer` returns one agent and its resolved `instruction`.
- `agents validate [team.yaml]` checks the docker-agent schema and semantic rules, and that no agent's generated `.claude/agents/<name>.md` is a Windows device name (`device-name`, with the output in `file`). Errors fail with `INVALID_AGENT_DEFINITION`; `details.files[].diagnostics` give `severity`, `code`, JSON `pointer`, `line`, `column` and `message`.
- `instruction_file` paths are relative to the definition and must stay in its folder or below.

## Author
- `agents create reviewer --file team.yaml --description "Reviews changes" --instruction "..." --toolset filesystem,shell --if-match <revision> --dry-run` adds an agent without touching other lines or comments. Omit `--if-match` for a new file. `--from-template basic|team|mcp` starts from a template.
- MCP, LSP, API and similar toolsets need settings: `edit agents/team.yaml --find … --replace … --if-match <revision>`, then `agents validate`.
- `agents import code-reviewer --from claude --file team.yaml` converts `.claude/agents/code-reviewer.md`. The conversion is approximate: read every diagnostic (`fidelity` `A` approximated, `U` dropped) and fix the YAML.
- `create` and `import` write only `.yaml` or `.yml` files directly in the definitions folder.

## Generate
- `agents generate --target claude --plan` reports each output's `status` (`missing`, `changed`, `hand-edited`, `unchanged`) and mapping `diagnostics`. Models other than Anthropic become `inherit`; unsupported toolsets and limits are dropped with warnings.
- `agents generate --target claude` writes new files. To replace existing outputs: `--plan-out review.json`, review, then `--revisions-from review.json`.
- Nothing that runs commands or grants permissions is written without opt-in: `--mcp inline|project`, `--hooks`, `--settings`, and `--allow-broad-permissions` for whole-tool rules. Read every `executes-command` and `grants-permission` diagnostic first.
- `--commands` writes commands as `.claude/skills/<name>/SKILL.md`; `--model-style alias` emits `opus`, `sonnet`, `haiku` or `fable`.
- Merges change only entries Forge recorded in `.claude/forge-generated.json`. A server name or main agent you set yourself fails with `AGENT_MERGE_CONFLICT`; `--rename-conflicts` (with `--mcp project`) renames the generated server.
- `agents generate --target claude --check` exits 5 with `AGENT_DRIFT` for `missing`, `changed`, `hand-edited` or `stale` outputs. Pass the same options as the generating run, and run it in CI.

## Know the limits
- Generated files carry `x-forge-source` provenance and pass `claude agents inspect <name>`.
- A docker-agent → Claude → docker-agent round trip is lossy; the YAML keeps what Claude cannot represent. See `bin/data/docs/reference/agents.md`.
