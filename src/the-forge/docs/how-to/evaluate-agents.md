# Evaluate agents

[Documentation](../index.md) · How-to

The agent evaluation harness measures whether an agent completes realistic Forge tasks, and at what cost. Each task gives an agent a prompt in a fresh fixture workspace and then verifies the end state with deterministic checks: files, frontmatter, structured data, command results and the final answer. Run it with the `reference` driver to prove the tasks are valid, and with the opt-in `claude` driver to measure Claude Code.

Run the commands from the Forge project directory `src/the-forge` after `npm run build`, because every task workspace copies the built distribution from the workspace `bin/`.

## Validate the tasks with the reference driver

```sh
npm run eval
npm run eval -- --task recover-stale-revision --task links-rename-note
npm run eval -- --category error-recovery
```

The reference driver (the default) replays each task's reference command sequence and requires three things: at least one check fails on the prepared fixture, so no check passes vacuously; every reference step succeeds, or fails with the code it expects; and afterwards every check passes, with answer checks matched against the task's reference answer. It prints a JSON summary and exits 1 when any task fails. `npm run check` runs the same driver over every task in `tests/evals/reference.e2e.test.ts`, which also requires that tasks use only commands the built executable registers.

## Measure Claude Code

```sh
npm run eval -- --driver claude
npm run eval -- --driver claude --task bases-add-view --repeat 3 --model sonnet
```

The `claude` driver runs `claude -p` headless in each task's workspace with `--output-format stream-json`, `--permission-mode dontAsk` and `--setting-sources project`. `setup` has already installed the Forge skills into `.claude/skills` and `.agents/skills` and written `AGENTS.md`, as in a real installation. By default the agent may run `node bin/forge.js` and the read-only native tools `Read`, `Glob` and `Grep`; pass `--allowed-tool <rule>` (repeatable) to change that, for example to compare against native `Edit`.

| Option | Default | Meaning |
| --- | --- | --- |
| `--repeat k` | 1 | Attempts per task; `passAllRate` is pass^k, the share of tasks that passed every attempt |
| `--model id` | Claude Code's default | Model for the session |
| `--max-turns n` | 30 | Turn limit per attempt |
| `--timeout seconds` | 600 | Time limit per attempt |
| `--claude path` | `claude` | The Claude Code executable |

The driver runs attempts one after another and writes `evals/results/<timestamp>.json`, which Git ignores: a summary with `passRate`, `passAllRate`, turns, cost, input, output and cache tokens, tool calls split into Forge CLI calls, other shell commands and native tools, and the number of Forge error codes the agent saw; per task the attempts and passes; and per attempt the check results and transcript metrics. Review failed checks and repeated error codes before changing a skill, a hint or a command.

The claude driver needs a locally installed and authenticated `claude`. It never runs in CI (it refuses when `CI` is set), and the repository holds no API keys.

## Write a task

Tasks live in `evals/tasks/<id>.yaml`; fixtures are folders under `evals/fixtures/` that are copied to the workspace root. The `vault` fixture is a small trip-planning vault with linked notes, a Canvas, a Base, a JSON configuration file, a workspace template and the managed project `projects/demo`.

```yaml
id: recover-stale-revision
title: Recover from a stale revision without losing a concurrent change
category: error-recovery
prompt: |
  Earlier you read Projects/Alpha.md at revision {{initial:Projects/Alpha.md}}. ...
fixture: vault
setup:
  - [edit, Projects/Alpha.md, --if-match, "{{initial:Projects/Alpha.md}}", --find, "- GPS accuracy in valleys.", --replace, "- GPS accuracy in valleys and canyons."]
reference:
  - run: [edit, Projects/Alpha.md, --if-match, "{{initial:Projects/Alpha.md}}", --find, "1. Prototype the share link.", --replace, "1. Prototype the share link with expiry."]
    expect: { code: CONFLICT }
  - [read, Projects/Alpha.md]
  - [edit, Projects/Alpha.md, --if-match, "{{revision:Projects/Alpha.md}}", --find, "1. Prototype the share link.", --replace, "1. Prototype the share link with expiry."]
checks:
  - file: Projects/Alpha.md
    contains: ["1. Prototype the share link with expiry.\n", "- GPS accuracy in valleys and canyons.\n"]
```

| Field | Meaning |
| --- | --- |
| `id`, `title`, `category` | The id equals the file name. Categories: `reading`, `searching`, `linking`, `editing`, `canvas-bases`, `backlog`, `generation`, `projects`, `error-recovery` |
| `prompt` | What the agent receives, in the user's words; never name the reference commands |
| `fixture` | A folder under `evals/fixtures` |
| `setup` | Forge commands run after `setup` and before the agent starts, for example another agent's concurrent change |
| `reference` | The command sequence that solves the task; a step is an argument list, or `{run, expect: {code}}` for an expected failure |
| `answer` | The reference final answer; required exactly when an `answer` check exists |
| `checks` | Deterministic assertions on the end state |

Arguments after `node bin/forge.js` omit `--root` and `--json`. In prompts and arguments, `{{revision:path}}` expands to the file's current SHA-256 and `{{initial:path}}` to its revision in the fixture, before setup.

| Check | Passes when |
| --- | --- |
| `{file, exists: false}` | The file does not exist |
| `{file, contains, notContains}` | The file exists and contains every listed text and none of the excluded ones |
| `{file, frontmatter}` | The YAML frontmatter contains the listed properties with equal values (deeply; other properties may exist) |
| `{file, data: {pointer, equals \| contains \| length}}` | The JSON Pointer into the parsed file (JSON for `.json` and `.canvas`, YAML for `.base` and `.yaml`) equals a value, contains a substring or a matching array element, or has a length |
| `{command, data?}` | The Forge command succeeds, and its `data` meets the pointer assertion |
| `{command, code}` | The Forge command fails with that code |
| `{unchanged: path}` | The file's bytes equal those after setup |
| `{answer: {contains}}` | The final answer mentions every listed text, ignoring case |

Prefer state checks over answer checks, check that unrelated content survived an edit, and add a check that fails on the prepared fixture. Validate the format with `npm run eval -- --task <id>`; the task schema is `taskSchema` in `scripts/eval/tasks.mjs`.

## Coverage and planned tasks

The 28 tasks cover reading, search, links and link-preserving moves and deletes, literal edits, properties, text files, Canvas, Bases, backlog planning, document and code generation, project scope, dry runs, and recovery from `CONFLICT`, `AMBIGUOUS_EDIT` and `NOT_FOUND`. They use only commands that exist today. Tasks for multi-edits, section edits and `apply` plans, and for `vault check`, are added when those commands land.
