# Competitive landscape and positioning

[Research index](README.md) · Researched 2026-10-10

## Summary

- **Obsidian shipped an official CLI** in desktop 1.12 (February 2026). It covers search, move/rename/delete, backlinks, Bases queries, history and plugins, but needs the desktop app running and documents no dry-run or revision guard. Official Obsidian Headless (open beta, npm, Node 22+) covers sync and publish, not editing.
- **The Forge's defensible core is narrow but real.** It is a headless write layer for Obsidian-format files with SHA-256 `--if-match` guards, universal dry-run, one JSON envelope with stable exit codes, Canvas validation and a standalone Bases evaluator. No surveyed vault tool combines these.
- **The vault space is crowded.** mcp-obsidian (about 4.5k stars), Basic Memory (4.1k), MCPVault (1.7k) and kepano/obsidian-skills (about 49k) already reach agents. The Forge has no MCP server, no npm package and no users, and `forge-vault` duplicates obsidian-skills.
- **Agent hosts already handle code-edit safety adequately** (Claude Code content matching, filesystem MCP `dryRun` diffs, Aider git commits). Revision guards pay off mainly for multi-writer files: a human in Obsidian plus agents.
- **Most other features are redundant** with leaders: Spec Kit (about 140k stars), OpenSpec (71k), BMAD (54k), Kiro, Taskmaster; Nx, Plop, shadcn, projen, Mitosis; rulesync, claude-code-templates and Claude Code's own plugin CLI.
- **Recommended position:** "The safe, headless write layer for Obsidian-format vaults, built for coding agents and CI." Next: search/move/rename/delete/links parity, npm distribution, a thin MCP adapter; freeze or move generators, UI, `claude` and workflow templates into plugins.

## Method

Read the brief, `README.md`, `bin/skills/forge-vault.md` and `docs/reference/{cli,claude}.md`. Competitor claims come from WebSearch/WebFetch of official docs, GitHub pages and changelogs on 2026-10-10. Star counts are as displayed when fetched (not API-verified; approximate). Claims from search summaries or third-party blogs are marked *(unverified)*. Products were judged on documentation, not hands-on testing.

## Landscape findings

### 1. Obsidian-native tooling

- **Official Obsidian CLI.** The [1.12.4 changelog](https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/) (2026-02-27) introduces it "for scripting, automation, and integration with external tools". The [CLI help](https://obsidian.md/help/cli) says it requires 1.12.7+ and a running Obsidian instance. Commands span file CRUD, `move`/`rename`/`delete` (trash by default), `search`, `property:set`, `backlinks`/`unresolved`/`orphans`, `base:query`, `history`/`diff`/`restore`, plugin management and `eval`. Output format varies by command; no dry-run or concurrency token is documented.
- **Obsidian Headless.** The [official headless client](https://obsidian.md/help/headless) is in open beta. It installs with `npm install -g obsidian-headless`, needs Node 22+, and syncs and publishes vaults without the desktop app. Its listed use cases include "giving agentic tools vault access". It documents no editing commands.
- **kepano/obsidian-skills.** [Agent Skills](https://github.com/kepano/obsidian-skills) from kepano (Obsidian CEO Steph Ango), about 49k stars: `obsidian-markdown`, `obsidian-bases`, `json-canvas`, `obsidian-cli`, `defuddle`, `knap`. Installed via Claude Code marketplace or `npx skills add`. It overlaps directly with The Forge's `forge-vault` skill.
- **Local REST API plugin.** [obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api) (about 3.0k stars): CRUD, heading/block/frontmatter patching, JsonLogic search, commands, SSE events and a built-in MCP endpoint, all inside a running Obsidian.
- **Community MCP servers.**
  - [mcp-obsidian](https://github.com/MarkusPfundstein/mcp-obsidian) (about 4.5k stars) offers 7 tools through the REST API plugin, so it needs Obsidian running.
  - [MCPVault](https://github.com/bitbonsai/mcpvault) (about 1.7k stars, MIT) works on files directly with no Obsidian. It has 18 tools, BM25 search, formatting-preserving frontmatter updates, traversal and symlink blocking, path-confirmation for delete and move, and `--read-only` mode. It is the closest functional peer to The Forge's file layer, but it has no revision token (none documented).
- **Basic Memory.** [Basic Memory](https://github.com/basicmachines-co/basic-memory) (about 4.1k stars, AGPL-3.0): Obsidian-compatible Markdown plus a SQLite index; MCP tools `write_note`, `edit_note`, `move_note`, `delete_note`, `search_notes`, `build_context`; a CLI; a $15–19/month cloud tier. It owns "agent memory in Markdown", not format-precise editing.
- **notesmd-cli.** Yakitrak renamed `obsidian-cli` to [notesmd-cli](https://github.com/Yakitrak/obsidian-cli?ref=eleanorkonik.com) "to avoid confusion with the Official Obsidian CLI". It is a Go CLI that works without Obsidian running and supports frontmatter edits, search and JSON output *(details from search summary, unverified)*.

### 2. Agent edit tools and safety models

- **Claude Code.** Per the [tools reference](https://code.claude.com/docs/en/tools-reference), Edit is exact, unique string replacement (`replace_all` optional). Since v2.1.208 it may edit a file changed on disk if `old_string` still matches current content; newer models may overwrite unread files with Write. Safety is content matching, not a revision token.
- **Gemini CLI.** The [`replace` tool](https://geminicli.com/docs/tools/file-system/) takes literal `old_string`/`new_string`, expects exactly one match unless `allow_multiple` is set, and requires user confirmation.
- **Codex CLI.** Edits go through `apply_patch` in the V4A context-anchored diff format, governed by separate sandbox and approval policies ([OpenAI sandboxing doc](https://developers.openai.com/codex/concepts/sandboxing.md); [V4A explainer, third-party](https://codex.danielvaughan.com/2026/03/31/codex-cli-apply-patch-v4a-diff-format/)).
- **Filesystem MCP server.** The [reference server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) has `edit_file` with an `edits[]` array and `dryRun`, which returns a git-style diff, plus allowed-directory roots. It documents no revision or concurrency checks, and `write_file` overwrites.
- **Aider.** [Aider](https://aider.chat/docs/git.html) auto-commits every edit, commits dirty files first, and offers `/undo`. Git is its safety net.

### 3. Code scaffolding and generators

- **Nx.** [Nx generators](https://nx.dev/docs/features/generate-code) are typed TS functions; the [Nx MCP server](https://nx.dev/docs/reference/nx-mcp) now hides generator tools by default because agent skills "provide that knowledge more efficiently", and `nx configure-ai-agents` sets up MCP and skills.
- **Plop, Hygen and Yeoman.** [Plop](https://plopjs.com/documentation/) runs non-interactively with CLI args, refuses overwrites by default, and documents no dry-run. An aggregator lists roughly 1.0M weekly downloads for Yeoman, 0.92M for Plop and 0.24M for Hygen ([npm-compare](https://npm-compare.com/ko-KR/hygen,plop,yeoman-generator), *unverified*).
- **shadcn.** The [CLI](https://ui.shadcn.com/docs/cli) has `add --dry-run`, `--diff` and `--view`, namespaced and private registries, and `build`. Its [MCP server](https://ui.shadcn.com/docs/mcp) lets agents browse, search and install registry items. v0 output can be installed as a registry namespace *(third-party, unverified)*.
- **projen.** [projen](https://github.com/projen/projen) (about 3.0k stars) synthesizes read-only config with an anti-tamper CI check, the same idea as The Forge's `--check` (exit 5).
- **Mitosis.** [Mitosis](https://github.com/BuilderIO/mitosis) (about 14.4k stars) compiles one component source to React, Vue, Angular, Svelte, Solid, Qwik and more: a more mature take on The Forge's seven-framework generator.
- **v0.** [v0](https://v0.app/docs) generates apps and UIs from prompts and opens PRs, weakening the case for boilerplate UI generators.

### 4. Spec-driven development and agent workflow

- **GitHub Spec Kit.** [Spec Kit](https://github.com/github/spec-kit) (about 140k stars): Python `specify` CLI plus agent skills for constitution, specify, plan, tasks, implement, converge; opt-in bug and idea extensions.
- **OpenSpec.** [OpenSpec](https://github.com/Fission-AI/OpenSpec) (about 71k stars, MIT; npm/brew): propose → apply → archive change folders, WHEN/THEN Markdown specs, "30+ AI assistants".
- **BMAD Method.** [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) (about 54k stars) is a scale-adaptive agile method installed as skills or plugins.
- **Kiro.** [Kiro specs](https://kiro.dev/docs/specs/) produce `requirements.md`, `design.md`, `tasks.md`; the [Kiro CLI](https://kiro.dev/docs/cli/) adds headless mode, steering, hooks and skills.
- **Taskmaster.** [Taskmaster](https://github.com/eyaltoledano/claude-task-master) (about 28k stars, MIT + Commons Clause) parses a PRD into tasks through a CLI and an MCP server with 36/15/7-tool modes.
- **Agent OS.** [Agent OS](https://github.com/buildermethods/agent-os) (about 5.5k stars) handles standards discovery and injection plus spec shaping.
- **Tessl.** [Tessl](https://tessl.io/)'s homepage now leads with a skills registry, evals and "loops" rather than a spec framework.

### 5. Agent configuration managers and standards

- **AGENTS.md.** [AGENTS.md](https://agents.md/) is stewarded by the Agentic AI Foundation under the Linux Foundation. It reports use in 60k+ open-source projects and 20+ supporting tools.
- **Agent Skills.** The [Agent Skills](https://agentskills.io/) standard (folder + `SKILL.md`, from Anthropic) lists Claude Code, Codex, Gemini CLI, Cursor, Copilot, Kiro, OpenCode and dozens more clients.
- **rulesync.** [rulesync](https://github.com/dyoshikawa/rulesync) (about 1.5k stars) imports, generates and converts rules, ignore files, MCP, commands, subagents, skills, hooks and permissions across dozens of tools.
- **claude-code-templates.** [claude-code-templates](https://github.com/davila7/claude-code-templates) (about 32.5k stars) installs agents, commands, hooks, MCPs, settings and skills, and adds analytics and a plugin dashboard.
- **Claude Code's own plugin tooling.** `claude plugin validate|init|tag` and marketplace commands ship with Claude Code ([plugins reference](https://code.claude.com/docs/en/plugins-reference); see also the [Claude blog](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)).
- **CLI versus MCP.** Practitioner posts argue that CLIs cost fewer tokens than MCP for local, single-user work, while MCP wins for auth and multi-tenant access ([manveerc](https://manveerc.substack.com/p/mcp-vs-cli-ai-agents), [PubNub](https://www.pubnub.com/blog/mcp-vs-cli-context-window-cost-blocks-ai); benchmarks *unverified*). Implication: CLI plus skill first, MCP as an adapter.

## Comparison matrix

The matrix uses Y = documented, P = partial, N = not documented or not offered, and "-" = not applicable.

| Capability | The Forge | Obsidian CLI | Obsidian Headless | MCPVault | mcp-obsidian / REST API | Basic Memory | FS MCP server | Claude Code Edit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Works without Obsidian running | Y | N | Y (sync only) | Y | N | Y | Y | Y |
| Read/create/write notes | Y | Y | N | Y | Y | Y | Y | Y |
| Frontmatter merge | Y | Y | N | Y | Y (patch) | P | N | N |
| Search | N | Y | N | Y (BM25) | Y | Y | P (filenames) | via Grep |
| Move/rename with link update | N | Y | N | P (move) | N | P (move; link update unverified) | P (move) | N |
| Delete | N | Y (trash) | N | Y (confirm) | Y | Y | N | N |
| Backlinks/links/orphans | N | Y | N | P (wikilink resolve) | N | P (relation graph) | N | N |
| Bases query | Y (standalone) | Y (in app) | N | N | N | N | N | N |
| Canvas structural validation | Y | N | N | N | N | N | N | N |
| Optimistic revision token on overwrite | Y (SHA-256) | N | - | N | N | N | N | P (current-content match) |
| Dry-run on every mutation | Y | N | - | N | N | N | P (edit_file) | N |
| Textual diff preview | N | Y (history diff) | - | N | N | N | Y | - |
| Uniform JSON envelope + exit codes | Y | P (per-command formats) | N | - (MCP) | - (MCP) | - (MCP) | - (MCP) | - |
| MCP interface | N | N | N | Y | Y | Y | Y | - |
| Install | copy `bin/` | bundled with app | npm | npx | plugin + server | package + CLI | npx | built in |

| Capability | The Forge | Nx | Plop | shadcn | projen | Mitosis | Spec Kit / OpenSpec / Kiro | rulesync |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Noninteractive generation | Y | Y | Y (args) | Y (`-y`) | Y | Y | Y | Y |
| Dry-run | Y | unverified | N | Y | N | N | - | unverified |
| Drift check of generated output | Y (exit 5) | N | N | P (`--diff`) | Y (anti-tamper) | N | - | N |
| Multi-framework UI output | Y (7) | P (per plugin) | N | N (React) | N | Y (8+) | - | - |
| Spec/PRD workflow templates | Y | N | N | N | N | N | Y (core) | N |
| Agent skills shipped | Y (3) | Y | N | P (MCP; skill third-party) | N | N | Y | Y (syncs) |
| Multi-agent config sync | N (Claude only) | N | N | N | N | N | - | Y |

## Where The Forge stands

**Strengths (differentiated)**

1. **Concurrency-safe writes to shared Markdown.** SHA-256 `--if-match` on every overwrite, a workspace lock and atomic rename. No surveyed vault tool documents an equivalent (closest: Claude Code content matching, MCPVault path confirmations). This matters most when humans edit in Obsidian while agents write.
2. **Headless Bases evaluation and Canvas validation.** Obsidian's `base:query` needs the app. The Forge evaluates saved views in CI, which no surveyed tool does.
3. **A machine contract, not a UI.** One envelope, stable exit codes, `schema --json` and universal dry-run. The official CLI's per-command output formats are friendlier to humans than to parsers.
4. **No runtime dependencies.** One bundle on Node 22+ fits CI and sandboxed agents, matching Obsidian Headless's Node 22+ baseline.

**Gaps**

- **No search, move/rename, delete or link graph.** The official CLI, MCPVault and Basic Memory all have these, so they are table stakes.
- **No MCP server or npm package, and no versioned or signed releases.** Every peer installs with one command.
- **Dry-run reports hashes and paths but no textual diff.** The filesystem MCP server and shadcn both show diffs.
- **No Windows or macOS CI.** Obsidian's audience is heavily desktop, and the CLI doc itself warns about cross-OS filenames.
- **The workspace lock does not coordinate with Obsidian or editors.** This is self-declared.
- **The skill format may not match the standard.** Skills are flat `bin/skills/*.md` files that are installed into `.agents/skills`. Conformance with the Agent Skills folder + `SKILL.md` layout should be confirmed.

**Redundancies**

`forge-vault` format guidance (vs. kepano/obsidian-skills); workflow templates (vs. Spec Kit, OpenSpec, BMAD, Kiro); TS and form scaffolds (vs. Nx, Plop, agents writing code directly); seven-framework UI and Storybook output (vs. Mitosis, v0); and the `claude` group (vs. Claude Code's plugin CLI, rulesync, claude-code-templates).

**Positioning analysis**

- **Target user.** An engineer or small team whose docs, specs or knowledge base live in an Obsidian-format vault inside a repository. Coding agents and CI jobs write to that vault while humans read and edit it in Obsidian.
- **Job to be done.** "Let my agents change vault files without clobbering human edits or corrupting Canvas/Bases, and let CI verify the vault, all without running Obsidian."
- **Candidate one-line positions:**
  - (A) "The safe, headless write layer for Obsidian-format vaults, for coding agents and CI." **Recommended.** It is credible today and stays distinct from the official CLI, which needs the app.
  - (B) "Deterministic, drift-checked generators for agent-driven TypeScript projects." Weak, because Nx, projen and shadcn already own it.
  - (C) "An agent-first engineering workspace." Too broad, with no evidence it wins anywhere.
- **Core features:** file operations, revision guards and dry-run, the JSON envelope and `schema`, `validate`, `bases query`, Canvas patching, `make document` from templates, and the vault skill, reframed around the safety protocol.
- **Distractions:** the UI, interactions and Storybook generators, forms, data sources, DDD scaffolds, the `claude` group, the workflow-template pack and the self-managed TS project system.

## Recommendations

| ID | Recommendation | Priority | Effort | Rationale and evidence |
| --- | --- | --- | --- | --- |
| CL-1 | Adopt position (A). Rewrite the README lead, `--help` summary and skills around "safe headless vault writes for agents/CI", and state the relationship to the official Obsidian CLI explicitly. | P0 | S | The [official CLI](https://obsidian.md/help/cli) owns "control Obsidian from the terminal"; notesmd-cli renamed itself to avoid confusion. The Forge's distinct value is headless plus guarded. |
| CL-2 | Add `search` (content + frontmatter, JSON hits with line numbers), `move`/`rename` with wikilink and embed rewriting, revision-guarded `delete` (to trash folder by default) and `links`/`backlinks`/`unresolved`. | P0 | L | Table stakes in the [Obsidian CLI](https://obsidian.md/help/cli), [MCPVault](https://github.com/bitbonsai/mcpvault) and [Basic Memory](https://github.com/basicmachines-co/basic-memory). Without them agents fall back to the shell and lose the guards. |
| CL-3 | Publish to npm (`npx the-forge ...`) with versioned, checksummed GitHub releases. Keep the committed `bin/` bundle as an option. | P0 | M | Every peer installs in one command: [Obsidian Headless](https://obsidian.md/help/headless) (npm), [OpenSpec](https://github.com/Fission-AI/OpenSpec) (npm/brew), MCPVault (npx). Copying `bin/` from a tarball is a barrier. |
| CL-4 | Add a unified text diff to every dry-run and conflict response. | P1 | S | Matches the filesystem MCP server's `dryRun` diff ([source](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)) and `shadcn add --diff` ([source](https://ui.shadcn.com/docs/cli)). Diffs are reviewable; hashes are not. |
| CL-5 | Ship a thin stdio MCP adapter in the presentation layer that maps 1:1 to existing commands, including `if_match` and `dry_run` parameters. | P1 | M | The vault MCP audience is large ([mcp-obsidian](https://github.com/MarkusPfundstein/mcp-obsidian) about 4.5k stars), but CLI-plus-skill stays cheaper in tokens ([manveerc](https://manveerc.substack.com/p/mcp-vs-cli-ai-agents)). The layered architecture already isolates presentation. |
| CL-6 | Make skills conform to Agent Skills (`<name>/SKILL.md` folders) and distribute them through `npx skills add` and a Claude Code plugin marketplace. Narrow `forge-vault` to the revision/dry-run protocol and point to kepano/obsidian-skills for format syntax. | P1 | S | [Agent Skills](https://agentskills.io/) is the cross-agent standard. [obsidian-skills](https://github.com/kepano/obsidian-skills) (about 49k stars) already teaches the formats, so complementing it beats competing with it. |
| CL-7 | Build a Bases conformance suite that compares `bases query` against the Obsidian CLI `base:query` (JSON) on fixture vaults, and publish the compatibility profile. | P1 | M | The standalone evaluator is a unique asset, but Obsidian keeps changing Bases (see the 1.12.4 Bases changes in the [changelog](https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/)). Drift is the main risk to it. |
| CL-8 | Add macOS and Windows to CI. | P1 | S | Obsidian users are desktop-heavy, and the CLI docs already flag cross-OS filename issues (`docs/reference/cli.md`). |
| CL-9 | Freeze the UI, interaction, Storybook, form, data-source and DDD generators, then move them into optional plugins or example packs outside the core bundle and docs front page. | P2 | M | They are redundant with [Mitosis](https://github.com/BuilderIO/mitosis), [Nx](https://nx.dev/docs/features/generate-code), [shadcn](https://ui.shadcn.com/docs/mcp) and [v0](https://v0.app/docs), and their output is "boilerplate only". They dilute the message and burden a single maintainer. |
| CL-10 | Reduce `claude` to revision-guarded editing of agent and hook files. Delegate lifecycle to `claude plugin` and cross-tool sync to rulesync. | P2 | S | [Claude Code plugin CLI](https://code.claude.com/docs/en/plugins-reference), [rulesync](https://github.com/dyoshikawa/rulesync) and [claude-code-templates](https://github.com/davila7/claude-code-templates) cover this job, and The Forge supports Claude only. |
| CL-11 | Replace the bespoke PRD and spec templates with validators and `make document` templates that read and write Spec Kit, OpenSpec and Kiro artifacts in a vault (frontmatter, task checkboxes, links). | P2 | M | [Spec Kit](https://github.com/github/spec-kit), [OpenSpec](https://github.com/Fission-AI/OpenSpec) and [Kiro](https://kiro.dev/docs/specs/) own the methodology. The Forge can be the safe editor and validator underneath them. |

## What not to build

- Not a spec-driven methodology, agent personas or task runner. Spec Kit, OpenSpec, BMAD, Kiro and Taskmaster dominate here.
- Not a skills registry or marketplace ([Tessl](https://tessl.io/), skills.sh and Claude marketplaces exist).
- Not sync, publish or hosted memory ([Obsidian Headless](https://obsidian.md/help/headless), [Basic Memory Cloud](https://github.com/basicmachines-co/basic-memory)).
- Not semantic or vector search or knowledge-graph memory. Keep search lexical and deterministic.
- Not cross-agent rules and config sync ([rulesync](https://github.com/dyoshikawa/rulesync)).
- Not more framework targets, Storybook depth or generative UI.
- Not an Obsidian app-control surface such as `eval`, themes or workspaces. Leave that to the official CLI.

## Open questions

- Will Obsidian add headless editing to the official CLI or to Obsidian Headless? The Headless page already lists "giving agentic tools vault access" as a use case. If it does, position (A) shrinks to "guarded writes plus CI validation".
- How do Forge writes interact with Obsidian's file recovery, Sync conflict handling and open editors while the app is running? This is untested, and the lock does not coordinate with Obsidian.
- Is there a real external user? Validate the job to be done with three to five teams that keep docs or specs in repo vaults, in parallel with CL-2.
- Should search be built in, or should the CLI delegate to the Obsidian CLI when the app is running?
- Should the self-managed TypeScript project system survive at all if the generators move out?
- The star counts and the Nx dry-run status were not independently verified through an API.

## Sources

- https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/
- https://obsidian.md/help/cli
- https://obsidian.md/help/headless
- https://github.com/kepano/obsidian-skills
- https://github.com/coddingtonbear/obsidian-local-rest-api
- https://github.com/MarkusPfundstein/mcp-obsidian
- https://github.com/bitbonsai/mcpvault
- https://github.com/basicmachines-co/basic-memory
- https://github.com/Yakitrak/obsidian-cli?ref=eleanorkonik.com
- https://code.claude.com/docs/en/tools-reference
- https://code.claude.com/docs/en/plugins-reference
- https://geminicli.com/docs/tools/file-system/
- https://developers.openai.com/codex/concepts/sandboxing.md
- https://codex.danielvaughan.com/2026/03/31/codex-cli-apply-patch-v4a-diff-format/
- https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem
- https://aider.chat/docs/git.html
- https://aider.chat/docs/more/edit-formats.html
- https://nx.dev/docs/features/generate-code
- https://nx.dev/docs/reference/nx-mcp
- https://plopjs.com/documentation/
- https://npm-compare.com/ko-KR/hygen,plop,yeoman-generator
- https://ui.shadcn.com/docs/cli
- https://ui.shadcn.com/docs/mcp
- https://github.com/projen/projen
- https://github.com/BuilderIO/mitosis
- https://v0.app/docs
- https://github.com/github/spec-kit
- https://github.com/Fission-AI/OpenSpec
- https://github.com/bmad-code-org/BMAD-METHOD
- https://kiro.dev/docs/specs/
- https://kiro.dev/docs/cli/
- https://github.com/eyaltoledano/claude-task-master
- https://github.com/buildermethods/agent-os
- https://tessl.io/
- https://agents.md/
- https://agentskills.io/
- https://github.com/dyoshikawa/rulesync
- https://github.com/davila7/claude-code-templates
- https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more
- https://developertoolkit.ai/en/ecosystem/frameworks/rules-sync/
- https://manveerc.substack.com/p/mcp-vs-cli-ai-agents
- https://www.pubnub.com/blog/mcp-vs-cli-context-window-cost-blocks-ai
