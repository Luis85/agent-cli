# Agent experience and interfaces

[Research index](README.md) · Researched 2026-10-10

## Summary

- Staying CLI-first is the right call. In 2025–2026, practitioners and Anthropic's own Claude Code guidance agree that a well-documented CLI is the most context-efficient interface for local coding agents. MCP's advantages are delegated auth, multi-user audit and services that have no CLI, and The Forge needs none of these today.
- The envelope design (`ok`/`error.code`/exit codes/`context`) is sound and better than most CLIs. Its cost comes from defaults. Every response carries two or more lifecycle `events` (about 310 bytes). That is 58% of a `project current` response. A Markdown `read` returns both `content` and `body`, so a 6.3 KB note with no frontmatter comes back as 13.8 KB.
- Non-Markdown text files such as `.ts`, `.json` and `.yaml` are classified as `attachment` and returned as base64. A 1,375-byte TypeScript file comes back as 2,961 bytes that the model cannot read. `edit` refuses anything that is not Markdown. For code, agents therefore skip Forge and lose its guards.
- `schema` is a catalog, not a contract. Options are typed only as `"string"`/`"boolean"`. It has no descriptions, required flags, enums, positional schemas, output schemas, error codes or read-only/mutating annotations. The source raises more than 100 distinct error codes, but `cli.md` documents about 12.
- The primitives agents use most are missing: search/grep, multi-edit, replace-all, line-range read, delete/move/rename with link updates, and diffs in dry-run output. The read→dry-run→write loop costs three calls and returns no preview of the edited text.
- The skills are useful but do not follow the Agent Skills spec. Descriptions lack "use when" triggers. `forge-workflow` packs workspace, UI, document and plugin guidance into dense paragraphs instead of using progressive disclosure.
- Top priorities: lean default output, text-file support, a contract-grade `schema`, an actionable error catalog, a `search` command, and an agent evaluation harness to measure all of the above.

## Method

1. I read the product brief, `docs/reference/cli.md`, the skills in `bin/skills/`, and the document command source (`src/the-forge/presentation/documents/commands.ts`, `domain/documents/file.ts`).
2. I ran only read-only commands (`help`, `schema`, `formats`, `config`, `events`, `project current`, `list`, `read`, catalog commands and error cases) and measured envelope sizes and event overhead. I ran no mutating commands, including dry runs.
3. I fetched primary guidance from Anthropic, OpenAI, Google, the MCP specification, agentskills.io, agents.md, clig.dev, gh, Terraform, Google AIPs and llms.txt, plus practitioner posts and benchmark abstracts. Items seen only in search snippets are marked *unverified*.

Token figures below use the rough rule that 1 token is about 4 bytes of JSON.

## Findings

### Tool design guidance for agents

- Anthropic recommends a few consolidated, workflow-shaped tools over thin API wrappers. It also recommends namespacing, returning "high signal information", and a `response_format` concise/detailed switch. Its Slack example used about a third of the tokens in concise mode. Responses should use pagination, filtering and truncation with sensible defaults, and Claude Code caps tool responses at 25,000 tokens by default ([Anthropic, Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)).
- The same article says errors should be "specific and actionable" rather than opaque codes, ideally with examples of correct input. It treats tool evaluation as tasks with verifiable outcomes, run in an agent loop, measured by accuracy, runtime, tool-call count, tokens and tool errors, with raw transcripts reviewed ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)).
- OpenAI says to use enums and structure "to prevent invalid states". It also says to apply the "intern test" and not to make the model supply arguments the application already knows. Functions always called in sequence should be combined, and fewer than about 20 tools should be available up front ([OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)). Google gives similar advice: strong typing, enums, 10–20 active tools at most, and validation before execution ([Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)).
- Claude Code's best practices call CLI tools "the most context-efficient way to interact with external services". They note that Claude learns unknown CLIs via `--help` and that the context window is "the most important resource to manage" ([Claude Code best practices](https://code.claude.com/docs/en/best-practices)).

### Edit primitives

- Anthropic's text editor tool offers `view` with `view_range` and line numbers, `str_replace` requiring exactly one match, `create` and `insert`. Its error guidance distinguishes "No match found" from multiple matches. `undo_edit` was removed in the Claude 4 version ([text editor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool)).
- OpenAI's `apply_patch` models edits as `create_file`/`update_file`/`delete_file` operations with diffs and per-operation `completed`/`failed` results ([OpenAI apply_patch](https://developers.openai.com/api/docs/guides/tools-apply-patch)). In both designs, delete is a basic operation and edits are diff-sized.

### CLI vs MCP, Skills and context cost

- Anthropic's code-execution-with-MCP post (4 Nov 2025) argues that direct tool calls waste context, because every definition loads up front and every intermediate result passes through the model. One workflow drops from about 150,000 to 2,000 tokens when tools are called from code instead ([Anthropic, Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)).
- Simon Willison: "Almost everything I might achieve with an MCP can be handled by a CLI tool instead." GitHub's MCP "famously consumes tens of thousands of tokens", while each skill costs "a few dozen extra tokens" until it is activated ([Willison, 16 Oct 2025](https://simonwillison.net/2025/Oct/16/claude-skills/)).
- A March 2026 decision framework picks the transport per integration. It favors CLI for local, single-developer, composable work and MCP for SaaS services without a CLI, multi-user OAuth and compliance audit. It cites about 55,000 initialization tokens for a GitHub MCP server ([Chawla, MCP vs CLI](https://manveerc.substack.com/p/mcp-vs-cli-ai-agents)). Benchmarks reporting a 4–32× token gap and 100% vs 72% reliability come from small vendor samples (*unverified*, search snippets only: [noqta.tn](https://noqta.tn/en/blog/mcp-vs-cli-ai-agents-tool-protocol-comparison-2026), [Deepline](https://deepline.com/blog/cli-vs-mcp-vs-sdk-for-gtm)).
- MCP itself has matured. The 2025-06-18 revision added `outputSchema` plus `structuredContent`, resource links and tool annotations, and it separates protocol errors from `isError` execution errors ([MCP tools spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)). The 2025-11-25 revision adds tool-name guidance, URL-mode elicitation, experimental tasks and JSON Schema 2020-12 as the default dialect. It also says input validation errors should be returned as tool execution errors "to enable model self-correction" ([MCP changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)).

### Skills, AGENTS.md and llms.txt

- The Agent Skills spec requires a `skill-name/SKILL.md` directory, a `name` that matches the directory, and a `description` (up to 1,024 characters) that says "what the skill does and when to use it" with trigger keywords. It recommends optional `scripts/`, `references/` and `assets/` directories and a body under about 5,000 tokens and 500 lines, with detail moved into one-level references. A `skills-ref validate` tool is available ([agentskills.io specification](https://agentskills.io/specification)). Anthropic describes the same three-level progressive disclosure and says Skills became an open standard on 18 Dec 2025 ([Anthropic, Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)).
- AGENTS.md is stewarded by the Agentic AI Foundation under the Linux Foundation and claims more than 60k projects; the nearest file wins ([agents.md](https://agents.md/)). Claude Code advises short always-loaded instructions, with situational knowledge in skills ([best practices](https://code.claude.com/docs/en/best-practices)). llms.txt is a Markdown link index for agents ([llmstxt.org](https://llmstxt.org/)).

### Machine-readable CLI contracts

- clig.dev: machine-readable output goes to stdout and messages to stderr. Map non-zero exit codes to the important failure modes, never require a prompt, offer `--dry-run`, "suggest commands the user should run", suggest a correction when the intended command is guessable, and make operations idempotent and recoverable ([clig.dev](https://clig.dev/)).
- `gh --json` takes an explicit field list. Calling it with no fields lists the available fields, and `--jq`/`--template` reshape output ([gh formatting](https://cli.github.com/manual/gh_help_formatting)).
- Terraform separates plan from apply with saved plan files and `-detailed-exitcode` (0 no changes, 1 error, 2 changes) ([terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan)).
- Google AIP-154 returns `ABORTED` (409) on an etag mismatch ([AIP-154](https://google.aip.dev/154)). AIP-163 says a `validate_only` request should return the same body the live call would and must fail when the live call would fail ([AIP-163](https://google.aip.dev/163)).

### Evaluating tool usability with agents

- MCPMark has 127 tasks across five environments, each with a state-verification script. The best model reached 52.56% pass@1 and 33.86% pass^4, and tasks averaged 17.4 tool calls ([MCPMark](https://huggingface.co/papers/2509.24002)). The common method: verify end state, use pass^k for reliability, and count calls, tokens and errors. MCP-Bench is similar (*unverified*: [MCP-Bench](https://huggingface.co/papers/2508.20453)).

## Assessment of The Forge

### Measured responses

| Command | Bytes | Event bytes | Notes |
| --- | --- | --- | --- |
| `project current` | 551 | 317 | 58% of the response is lifecycle events |
| `formats` | 927 | 317 | — |
| `config` | 1,178 | 315 | — |
| `make` (catalog) | 1,453 | 311 | — |
| `schema` / `help` | 9,556 / 9,552 | 315 | Same payload; about 2.4k tokens |
| `list` (102 files) | 7,039 | 339 | About 69 B per file; no limit, glob or cursor |
| `read README.md` (6,326 B, no frontmatter) | 13,832 | 664 (4 events) | `content` and `body` are identical |
| `read application/bases/query.ts` (1,375 B) | 2,961 | — | Returned as base64 `attachment` |

At about 69 bytes per file, a 5,000-file vault's `list` would be around 345 KB (about 86k tokens). That is far beyond the 25,000-token cap Anthropic cites.

### Strengths

- **One envelope everywhere.** Stable `error.code`, distinct exit codes (2 invalid/conflict, 3 missing, 4 busy, 5 drift), and no prompts or ANSI output, as clig.dev recommends.
- **Optimistic concurrency.** `--if-match` is required on every overwrite, and write results return the new `revision` in `changes[]`, so agents can chain edits without re-reading (the AIP-154 etag pattern).
- **Universal `--dry-run`.** Generators include a full `preview`, and `--plan`/`--check` with exit 5 mirrors Terraform's plan and `-detailed-exitcode`.
- **`context` on every response.** Scope is explicit, which guards against writing relative paths into the wrong root.
- **`edit` mirrors `str_replace`.** It requires exactly one literal match.
- **Small catalog.** 24 commands at about 2.4k tokens, roughly 20× cheaper than a large MCP server's initialization.
- **Some actionable errors.** `UNKNOWN_COMMAND` says "Run help or schema", and an invalid `--kind` lists the valid values.

### Gaps

1. **Verbose defaults.** `command.started`/`command.succeeded` events appear on every call, even reads, and a `read` adds `workspace.*` events too. Agents gain nothing from them, because committed file changes are already listed in `data.changes`. `read` duplicates the note body. There is no concise mode, field selection or `--limit` on `list`.
2. **Text is treated as binary.** Only `md`/`canvas`/`base` are text. TypeScript, JSON, YAML, CSS and config files come back as base64 and cannot be edited with `edit`. That undermines the "agent-first" claim for the TypeScript half of the product, because agents will fall back to native Read/Edit and lose revision guards.
3. **`schema` is not a contract.** It has no per-option descriptions, required or enum values, positional argument schemas, output JSON Schema, error-code list, or read-only/mutating/dry-run/revision annotations. `envelope.output` is a prose string. `help` with no arguments returns the same payload as `schema`. There is no `schema <command>` for progressive disclosure.
4. **Error catalog and actionability.**
   - The source contains more than 100 codes, including `NOT_FOUND`, `UNSUPPORTED_EDIT`, `INVALID_INPUT`, `INVALID_ENCODING` and `PROJECT_REQUIRED`. `cli.md` lists 12, and nothing machine-readable enumerates them.
   - `AMBIGUOUS_EDIT` covers both zero and multiple matches and reports neither the count nor the locations.
   - `CONFLICT` does not return the current revision.
   - `NOT_FOUND` does not suggest nearby paths.
   - Unknown-command errors are pretty-printed while others are compact. That is harmless, but it is inconsistent.
5. **Loop cost without preview.** A guarded Markdown edit takes `read` (about 2.2× the file), then `edit --dry-run`, then `edit`. The dry run returns only `{path, revision, operation, bytes}`, with no diff, so the agent learns little from the extra call.
6. **Missing primitives.**
   - Search/grep.
   - Multi-edit or replace-all.
   - Line-range read.
   - Delete/move/rename with wikilink updates, plus backlinks.
   - A multi-file transaction from a plan file.
   - An undo or journal.
7. **Hidden shared state.** `project open` persists the selection in `bin/data/context.json`, which changes how every relative path resolves for all agents in the workspace. The skills already warn "Do not assume a concurrent agent has left the selection unchanged". Only `make ui/stories/data-source` accept a per-invocation `--project`.
8. **Confusing flag name.** `--no-json` still emits JSON (pretty-printed).
9. **Skill quality.** Skills ship as flat `bin/skills/*.md` files (installed as `<id>/SKILL.md`). Descriptions say what, not when. `forge-workflow` (5.8 KB) mixes setup, projects, UI, workflow documents and plugins in very long paragraphs, with no `references/` split or spec validation. The bodies duplicate `cli.md` prose and can drift.
10. **No agent-level evidence.** The test pyramid covers code behavior, but nothing measures whether an agent completes tasks with Forge, or at what token and call cost.

## Recommendations

| ID | Recommendation | Priority | Effort | Rationale and evidence |
| --- | --- | --- | --- | --- |
| AX-1 | Make lifecycle `events` opt-in (`--events` or `settings.events`). By default emit only `file.*` commit records, or none, since `data.changes` already lists them. | P0 | S | Events are 58% of small responses. Anthropic: return high-signal information and use concise defaults ([source](https://www.anthropic.com/engineering/writing-tools-for-agents)). |
| AX-2 | Stop duplicating `read` output. Return `content` plus `properties` by default and offer `--parts body,properties` or `--format parsed`. | P0 | S | A 6.3 KB note returns 13.8 KB. Anthropic's `response_format` concise mode used about a third of the tokens. |
| AX-3 | Add a `text` kind for UTF-8 files (`ts`, `js`, `json`, `yaml`, `css`, `txt`, and so on) and allow `edit` on any text file. Keep base64 for true binaries. | P0 | M | Base64 TypeScript is unreadable and 2.15× larger, so agents bypass Forge's guards. Text editor tool precedent ([source](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool)). |
| AX-4 | Upgrade `schema` into a contract. Use JSON Schema 2020-12 for each command's positional args and options (description, required, enum, default), give the envelope and each command an output schema, list error codes per command, and add annotations (`readOnly`, `mutates`, `dryRun`, `requiresRevision`, `scope`). Add `schema <command>` and make `help` concise. | P0 | M | OpenAI and Google: enums and strong typing prevent invalid calls. MCP `inputSchema`/`outputSchema`/annotations ([source](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)). Progressive disclosure ([source](https://agentskills.io/specification)). |
| AX-5 | Publish a complete error catalog and add a test asserting that every thrown code is catalogued. Add `error.hint`, `error.retryable` and `error.next` (suggested commands). Split `NO_MATCH` from `AMBIGUOUS_EDIT` with `details.matches` and line numbers. `CONFLICT` should return `details.currentRevision`. `NOT_FOUND` should suggest close paths. | P0 | S | "Specific and actionable" errors ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)). clig.dev's suggest-next-command and did-you-mean ([clig.dev](https://clig.dev/)). |
| AX-6 | Add `search <pattern> [--regex] [--kind] [--path glob] [--limit] [--context n]` returning path, line, snippet and revision. Add `--path`, `--limit` and `--cursor` to `list`. | P1 | M | Search over list ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)). Large vaults would exceed the 25k-token cap. |
| AX-7 | Make dry-run of `edit`/`write`/`properties`/`patch` return a unified diff (`data.diff`). Allow `--if-match` on a dry run so that it returns exactly what the live call would. | P1 | S | AIP-163: validate-only returns what the live call returns ([source](https://google.aip.dev/163)). Today's dry run gives no preview. |
| AX-8 | Add multi-edit: `edit --edits-from file.json` (an ordered list of find/replace pairs in one file, all-or-nothing) and `--replace-all --expect-count n`. Add `apply <plan.json>` for multi-file batches with per-file revisions, reusing the existing batch planner. | P1 | M | Combine calls that are always made in sequence ([OpenAI](https://developers.openai.com/api/docs/guides/function-calling)). apply_patch multi-operation model ([source](https://developers.openai.com/api/docs/guides/tools-apply-patch)). |
| AX-9 | Add revision-guarded `delete`, `move`/`rename` that rewrite wikilinks and embeds (dry-run lists affected notes), and `links`/`backlinks`. | P1 | M | apply_patch treats delete as a basic operation. This is a self-declared gap, and vault refactoring is impossible without it. |
| AX-10 | Add a global per-invocation `--project <id>` (or `--scope workspace`) for every scoped command, and recommend it over persisted selection in the skills. | P1 | S | Stateless calls avoid cross-agent interference. The skills already warn about concurrent selection changes. |
| AX-11 | Bring the skills to the Agent Skills spec: author them as `skill/SKILL.md` directories, add "Use when…" trigger descriptions, split `forge-workflow` into narrower skills (for example UI generation and workflow documents), move detail into `references/`, and run `skills-ref validate` in `npm run check`. | P1 | S | Spec requires what plus when, with a body under 5k tokens and one-level references ([source](https://agentskills.io/specification)). |
| AX-12 | Build an agent evaluation harness: 20–30 realistic tasks (note edits, canvas changes, base queries, UI regeneration with conflicts) with state-verification scripts. Run them via `claude -p --output-format stream-json`, record pass^k, tool calls, tokens, `CONFLICT`/error rates, and how often the agent falls back to native tools. Review transcripts. | P1 | M | Anthropic eval method ([source](https://www.anthropic.com/engineering/writing-tools-for-agents)). MCPMark-style verified end states ([source](https://huggingface.co/papers/2509.24002)). |
| AX-13 | Add output shaping: `--fields a,b` or `--select /json/pointer` (gh-style). Rename `--no-json` to `--pretty`. | P2 | S | `gh --json` fields and `--jq` ([source](https://cli.github.com/manual/gh_help_formatting)). |
| AX-14 | Add an optional thin MCP stdio adapter generated from the same command registry: one tool per command group, with `outputSchema`, `structuredContent`, annotations and `isError`. Do this only after AX-4 and AX-12 show a client that needs it. | P2 | M | MCP fits non-shell hosts. The CLI stays canonical ([Chawla](https://manveerc.substack.com/p/mcp-vs-cli-ai-agents), [MCP spec](https://modelcontextprotocol.io/specification/2025-11-25/changelog)). |
| AX-15 | Ship `llms.txt` for `docs/` and `bin/data/docs`, and keep the generated AGENTS.md as a short pointer to it and the skills. | P2 | S | [llmstxt.org](https://llmstxt.org/). Short always-loaded context ([Claude Code](https://code.claude.com/docs/en/best-practices)). |
| AX-16 | Add an operation journal storing pre-images for the last N batches, plus `revert <operationId>` guarded by current revisions. | P2 | M | clig.dev "make it recoverable" ([source](https://clig.dev/)). The batches are not crash-atomic today. |

## What not to build

- **An MCP-first rewrite or a resident daemon.** The evidence favors CLI for local single-user work, and a daemon conflicts with the portable, stateless design.
- **One MCP tool per subcommand.** That would mean 60+ tools, against OpenAI's and Google's 10–20 guidance.
- **A general replacement for agents' native Read/Edit/Grep on source code.** Make Forge interoperable through AX-3 and AX-6, not exclusive. Its value is guarded vault and generator semantics.
- **Interactive prompts or MCP elicitation flows.** They break the noninteractive contract.
- **Automatic retries after `CONFLICT`, or optional revisions on overwrite.** Reconciliation must stay explicit.
- **Embedded LLM calls or "smart" natural-language commands inside the CLI.**
- **Telemetry that phones home** in place of the local evaluation harness.

## Open questions

- Which agent hosts matter first: Claude Code, Codex, Cursor, or the Agent SDK? This decides whether an MCP adapter or Claude Code plugin packaging is worth it.
- Does any consumer actually use the per-response `events` array, or only plugin listeners in-process?
- Should persisted project selection remain at all once `--project` is global?
- How often do agents prefer Forge over native tools for Markdown when both are available? Only AX-12 can answer this.
- Should short revision prefixes (for example 16 hex characters) be accepted to cut about 30 tokens per guarded call? What collision policy would apply?
- What is the right default page size for `list` and `search` for large vaults?

## Sources

- Anthropic, Writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic, Code execution with MCP (4 Nov 2025): https://www.anthropic.com/engineering/code-execution-with-mcp
- Anthropic, Equipping agents for the real world with Agent Skills: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Claude text editor tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool
- OpenAI function calling: https://developers.openai.com/api/docs/guides/function-calling
- OpenAI apply_patch tool: https://developers.openai.com/api/docs/guides/tools-apply-patch
- Google Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling
- MCP tools specification 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP changelog 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/changelog
- Agent Skills specification: https://agentskills.io/specification
- AGENTS.md: https://agents.md/
- llms.txt: https://llmstxt.org/
- Command Line Interface Guidelines: https://clig.dev/
- GitHub CLI formatting: https://cli.github.com/manual/gh_help_formatting
- Terraform plan: https://developer.hashicorp.com/terraform/cli/commands/plan
- Google AIP-154 (etags): https://google.aip.dev/154
- Google AIP-163 (validate only): https://google.aip.dev/163
- Simon Willison, Claude Skills are awesome, maybe a bigger deal than MCP: https://simonwillison.net/2025/Oct/16/claude-skills/
- Manveer Chawla, MCP vs. CLI for AI agents (8 Mar 2026): https://manveerc.substack.com/p/mcp-vs-cli-ai-agents
- MCPMark: https://huggingface.co/papers/2509.24002
- Unverified (search snippets only): MCP-Bench https://huggingface.co/papers/2508.20453; noqta.tn https://noqta.tn/en/blog/mcp-vs-cli-ai-agents-tool-protocol-comparison-2026; Deepline https://deepline.com/blog/cli-vs-mcp-vs-sdk-for-gtm
