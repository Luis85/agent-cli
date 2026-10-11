# Manage agent definitions and generate Claude Code agents

[Documentation](../index.md) · How-to

Use this workflow to keep your team's agents in [docker-agent](https://github.com/docker/docker-agent) YAML files and generate Claude Code agents from them. The YAML files are the source of truth: you edit them, Forge validates them and regenerates `.claude/agents/`, and CI checks that the generated files still match. The [agents reference](../reference/agents.md) lists every option, diagnostic and mapping rule.

## Inspect the definitions

```sh
node bin/forge.js project current --json
node bin/forge.js agents list
node bin/forge.js agents validate
```

Definitions live in the selected scope's `agents/` folder, one team per `*.yaml` file. `list` shows each file's `revision`, its agents and its default agent (`root`, else the first). `validate` checks every file against docker-agent's schema and load-time rules and fails with `INVALID_AGENT_DEFINITION` when a file has errors; each diagnostic in `details.files[].diagnostics` names a JSON `pointer`, a `line` and a `column`. Inspect one agent, with its resolved `instruction_file` text, as `agents inspect team.yaml#reviewer`.

To keep definitions elsewhere, set `plugins.settings.agents.directory` in `bin/config.json`, for example `{"plugins": {"settings": {"agents": {"directory": "team/agents"}}}}`.

## Create a team

Create the lead agent, which starts a new file, then add a specialist to the same file with its revision:

```sh
node bin/forge.js agents create lead --file team.yaml --description "Plans and delegates the work." --instruction "Break the request into tasks and delegate them." --toolset filesystem,shell
node bin/forge.js agents list
node bin/forge.js agents create reviewer --file team.yaml --description "Reviews changes for defects." --toolset filesystem --if-match TEAM_REVISION --dry-run
node bin/forge.js agents create reviewer --file team.yaml --description "Reviews changes for defects." --toolset filesystem --if-match TEAM_REVISION
```

Or start from a bundled template: `basic` (one read-only agent), `team` (a coordinator with `<name>-researcher` and `<name>-writer` sub-agents) or `mcp` (an agent with a Docker MCP Gateway server):

```sh
node bin/forge.js agents create docs --from-template team --file docs-team.yaml --description "Keeps the docs current."
```

`create` and `import` write only files directly in the definitions folder (`team.yaml` or `agents/team.yaml`); other paths fail with `INVALID_PATH`.

Adding an agent inserts its YAML after the last agent and leaves the rest of the file, comments included, unchanged. For settings the command does not offer, such as `sub_agents`, MCP toolsets or commands, edit the file in your editor or Obsidian (or change it with `edit agents/team.yaml --find … --replace … --if-match TEAM_REVISION`), then validate it:

```sh
node bin/forge.js agents validate team.yaml
```

Any docker-agent example works as a starting point: models, shared `mcps`, `toolsets`, `commands` and `permissions` are all validated.

## Generate the Claude agents

Preview, then write:

```sh
node bin/forge.js agents generate --target claude --plan
node bin/forge.js agents generate --target claude
```

Read `data.diagnostics` before you rely on the result. Warnings mark approximations (for example a non-Anthropic model becomes `model: inherit`, `think` is dropped, sub-agents become `Agent(…)` tool entries) and dropped behavior (unsupported toolsets, delegation settings, or a filesystem `allow_list` that Claude cannot enforce). Each diagnostic's `pointer` names the definition setting it comes from.

Generated Claude files can run commands and grant permissions, so Forge writes nothing of that kind unless you ask for it. By default MCP servers and hooks are skipped (`mcp-not-generated`, `hooks-not-generated`) and every agent gets an explicit `tools` list, `tools: []` when its toolsets grant no Claude tool. Opt in with the same options on every run:

- `--mcp inline` writes MCP servers into each agent's frontmatter; `--mcp project` merges them into the project's `.mcp.json`.
- `--hooks` writes the definitions' command hooks.
- `--settings` merges the definitions' permissions as Claude permission rules, and the default agent as the project's main agent, into `.claude/settings.json`. Rules that approve a whole tool, such as `Bash` or `WebFetch`, also need `--allow-broad-permissions`.
- `--commands` writes docker-agent `/commands` as `.claude/skills/<name>/SKILL.md`.
- `--model-style alias` writes `sonnet`, `opus`, `haiku` or `fable` instead of model ids.

Review the plan before you opt in: each written MCP server or hook command is an `executes-command` warning with the full command line, and each permission rule a `grants-permission` warning with the exact rule.

Merges change only entries Forge wrote, which it records in `.claude/forge-generated.json`. A generated MCP server whose name `.mcp.json` already uses for another server, or a main agent you set yourself, fails with `AGENT_MERGE_CONFLICT`; rename the toolset's server, pass `--rename-conflicts` to give the generated server a numbered name, or remove your entry. Merged files keep their indentation and key order.

## Regenerate after a change

Edit the definition, then review and approve the regeneration; Forge never overwrites an existing output without an approved revision:

```sh
node bin/forge.js agents generate --target claude --plan-out agents-review.json
node bin/forge.js agents generate --target claude --revisions-from agents-review.json
```

In the plan, an output's `status` is `changed` when its definition, an instruction file or the generation options changed, and `hand-edited` when the file no longer matches what Forge recorded when it wrote it. A hand edit is lost on regeneration, so move the change into the definition first. `stale` lists generated files whose agent no longer exists; delete them with `delete <path> --if-match <revision>`.

## Check for drift in CI

```sh
node bin/forge.js agents validate
node bin/forge.js agents generate --target claude --check
```

`--check` exits 5 with `AGENT_DRIFT` and lists every `missing`, `changed`, `hand-edited` or `stale` output in `error.details`. Run it with the same `--mcp`, `--hooks`, `--settings`, `--commands` and `--model-style` options as your generation.

## Import an existing Claude agent

Bring a hand-written Claude agent into a team file:

```sh
node bin/forge.js agents import code-reviewer --from claude --file team.yaml --if-match TEAM_REVISION --dry-run
node bin/forge.js agents import code-reviewer --from claude --file team.yaml --if-match TEAM_REVISION
```

The import is approximate. Every diagnostic with fidelity `A` or `U` names a Claude field that changed meaning or was dropped, such as `permissionMode`, `WebSearch` or an `Agent(…)` entry whose agent is not in the file. Fix the YAML, run `agents validate`, then regenerate: the next plan reports the original Claude file as `hand-edited`, because it has no provenance yet, so approve it with `--plan-out` and `--revisions-from`.
