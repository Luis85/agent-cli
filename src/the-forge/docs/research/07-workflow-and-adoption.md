# Engineering workflow and adoption

[Research index](README.md) · Researched 2026-10-10

## Summary

- **The market has settled on a few conventions, and The Forge follows only some of them.** Teams now plan AI-assisted work in Markdown: spec, then plan, then tasks, then implement. They carry context through AGENTS.md and SKILL.md folders, and they verify with checks the agent can run. Spec Kit, OpenSpec, BMAD and Kiro already own the "spec workflow" category, and each installs with one command. The Forge's templates are well written, but they are standalone documents rather than a loop.
- **AI amplifies whatever process a team already has.** DORA 2025 reports 90% adoption and finds that AI magnifies both strengths and dysfunctions. Faros measured 91% longer PR review time on teams that use AI heavily. A tool that adds *verification and traceability* addresses that bottleneck. A tool that only adds more generated Markdown does not.
- **The Forge's best differentiator is its deterministic, guarded, JSON-contract layer.** Revision guards, dry runs, exit codes and a 9.5 KB `schema --json` catalogue match current context-engineering advice: "smallest possible set of high-signal tokens", and CLIs as the most context-efficient interface. No spec framework surveyed offers write safety of this kind.
- **Onboarding is the largest adoption blocker.** Installing today means curling a tarball of `main`, copying `bin/`, running two manual reset commands, and working inside a separate workspace with a `projects/` folder. There is no npm package and no path for adopting an existing repository.
- **There is a portability gap in skills.** `skills install` defaults to `.agents/skills`, which Codex reads. Claude Code documents only `.claude/skills`, so The Forge's own skills may never load in the agent it manages most deeply.
- **The name collides heavily.** Atlassian Forge already ships a Claude Code plugin. Foundry's `forge`, Laravel Forge and the ForgeCode AI agent are also in use; ForgeCode is published on npm as `forgecode` and listed as a Spec Kit integration named "Forge".
- **The scope is too broad for one maintainer with no users.** The Forge has 24 top-level commands. They span Obsidian vault editing, seven UI framework targets, forms, data sources, Bases queries and Claude Code administration. Pick one job to be done before launch.
- **Recommended persona:** a TypeScript tech lead on a team of 1–8 who runs Claude Code and/or Codex from the terminal and wants traceable, review-friendly planning artifacts and safe agent writes inside an existing repository.

## Method

I read the product brief, README, docs hub, both tutorials, the workflow-template how-to, the Claude Code reference, the workflow templates and the stage prompts. I also ran the read-only commands `--version` (about 0.2 s) and `schema --json`; the bundle is 2.7 MB. External research used web search and direct fetches of primary sources: vendor docs, project READMEs, survey pages and research posts, all on 2026-10-10. Claims backed only by secondary coverage are marked *(secondary)*. Star counts are as displayed on the fetch date. Persona and priority judgements are analyst inference, without user interviews.

## Findings

### 1. How teams run AI-assisted delivery in 2025–2026

- **Usage is near-universal, but trust is low.** [DORA 2025](https://blog.google/technology/developers/dora-report-2025/) reports 90% adoption, but only 24% trust AI output a lot. Its central claim is that AI acts as a "mirror and a multiplier" of existing team health ([InfoQ](https://www.infoq.com/news/2025/09/dora-state-of-ai-in-dev-2025)). The [Stack Overflow 2025 survey](https://survey.stackoverflow.co/2025/ai) agrees: 84% use or plan to use AI, but only 32.7% trust its accuracy. The top frustration (66%) is answers that are "almost right, but not quite". Only 30.9% use agents at work.
- **Productivity evidence is contested, and review is the bottleneck.** [METR's 2025 RCT](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) found experienced developers 19% slower with AI, even though they believed they were 20% faster. [METR's February 2026 update](https://metr.org/blog/2026-02-24-uplift-update/) estimates speedups of about 18% for returning developers and 4% for new recruits. METR calls that data an "unreliable signal" because of selection effects. [Faros AI](https://www.faros.ai/blog/ai-software-engineering) measured 10,000+ developers. High-adoption teams merged 98% more PRs, but review time rose 91% and PR size 154%, with no company-level improvement.
- **Spec-driven development (SDD) is now a category.**
  - [GitHub Spec Kit](https://github.com/github/spec-kit) has 140.6k stars and installs with `uv tool install specify-cli`. It runs constitution, then specify, plan, tasks and implement, has extensions and presets, and [lists 38 agent integrations](https://github.github.com/spec-kit/), including one called "Forge".
  - [OpenSpec](https://github.com/Fission-AI/OpenSpec) has 71.5k stars and installs with `npm i -g`. It uses per-change folders (proposal, specs, design, tasks) that are archived on completion, with no rigid gates, and supports 30+ tools.
  - [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) has 54k stars and installs with `npx skills add` or a Claude/Codex plugin marketplace. It uses role-based agents and scales depth to the size of the work: "Small changes go straight to build."
  - [Kiro](https://kiro.dev/docs/specs/) produces requirements, design and tasks files. It has a separate bugfix spec and a gate-free "Quick Spec", and it runs tasks in parallel waves from a dependency graph.
- **Critics flag ceremony and review burden.** [Böckeler on martinfowler.com](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) found Kiro turning a small bug into 4 user stories with 16 acceptance criteria. She found Spec Kit's Markdown "repetitive, verbose and tedious" to review, and saw agents ignore spec content. Her verdict is that current tools are "spec-first", seldom "spec-anchored". [OpenSpec's README](https://github.com/Fission-AI/OpenSpec) markets itself against Spec Kit's "heavyweight" gates; that is the vendor's own view.
- **Vendors now agree on the core loop: plan, then act, then verify.** [Claude Code best practices](https://code.claude.com/docs/en/best-practices) recommend explore → plan → implement → commit. They warn that plan mode "adds overhead" for one-sentence diffs, and they make "give Claude a way to verify its work" (tests, Stop hooks, a verification subagent) the top practice. ADRs are increasingly recommended as agent context ([Davidson](https://duncandavidson.com/agents-love-decisions), [thestateofme](https://blog.thestateofme.com/2025/07/10/using-architecture-decision-records-adrs-with-ai-coding-assistants/)) *(secondary)*.
- **Background and CI agents are mainstream workflow surfaces.** In [Copilot coding agent](https://docs.github.com/en/copilot/using-github-copilot/coding-agent/using-copilot-to-work-on-an-issue), a team assigns an issue and gets a draft PR back. [Claude Code Action](https://github.com/anthropics/claude-code-action) triggers on `@claude`, on issue assignment, or on prompt automation, and returns structured JSON outputs.

### 2. Context engineering and configuration portability

- **Context is a finite budget.** [Chroma's context-rot study](https://www.trychroma.com/research/context-rot) tested 18 models and found performance drops with input length even on simple tasks, and drops further with topically similar distractors. Anthropic's [context-engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) recommends just-in-time retrieval, compaction, structured notes and sub-agents. It also warns against "bloated tool sets".
- **AGENTS.md is the cross-tool baseline.** It is now [stewarded by the Agentic AI Foundation](https://agents.md/) under the Linux Foundation. Claude Code [now reads AGENTS.md natively](https://code.claude.com/docs/en/memory) from v2.1.277 when no CLAUDE.md exists.
- **Skills are an open standard, but the install paths differ.** [Agent Skills](https://agentskills.io/home) lists 40+ clients, including Claude Code, Codex, Cursor, Copilot, Gemini CLI and Kiro. Claude Code loads skills from `~/.claude/skills`, `.claude/skills` and plugin directories ([skills docs](https://code.claude.com/docs/en/skills)); `.agents/skills` is not documented there. [Codex](https://learn.chatgpt.com/docs/build-skills) loads from `.agents/skills` from the working directory up to the repository root. The installer convention is `npx skills add owner/repo` ([Vercel](https://vercel.com/docs/agent-resources/skills)).
- **Team distribution goes through plugin marketplaces.** A team marketplace is a git repository with `.claude-plugin/marketplace.json`, and admins can require it on every machine ([marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)).
- **Cross-agent sync tools already exist.** [Ruler](https://github.com/intellectronica/ruler) (2.9k stars, run via `npx`) writes one `.ruler/` source of rules, MCP config, skills and subagents into about 30 agents.

### 3. Onboarding, documentation and naming

- **Developer experience comes down to feedback loops, cognitive load and flow** ([DevEx, ACM Queue](https://queue.acm.org/detail.cfm?id=3595878); full text was blocked, so this is confirmed via [InfoQ](https://www.infoq.com/articles/devex-metrics-framework) *(secondary)*). Every tool compared above makes its first step one command, followed by one agent prompt.
- **"Forge" is crowded:**
  - [Atlassian Forge](https://developer.atlassian.com/platform/forge/) uses an `@forge/cli` package and ships an [`atlassian-forge-skills` Claude plugin](https://claude.com/plugins/atlassian-forge-skills).
  - [Foundry `forge`](https://getfoundry.sh/forge/overview) is a Solidity build tool.
  - Laravel Forge is a server-management product (its domain redirects to laravel.com/forge; not fetched further).
  - [ForgeCode](https://forgecode.dev/docs) is an AI coding agent in the terminal. Its npm package `forgecode` was updated in July 2026.

  On the npm registry (checked 2026-10-10), `agent-cli` and `forge-cli` are taken, while `the-forge` and `@the-forge/cli` return 404 (unclaimed).

### 4. OSS go-to-market for a solo maintainer

- **Show HN requires something people can try** without signups, built by the poster, and "ready for users" ([Show HN rules](https://news.ycombinator.com/showhn.html)).
- **Trust signals are cheap to add.** [npm provenance and trusted publishing](https://docs.npmjs.com/generating-provenance-statements) sign builds through Sigstore from GitHub Actions. [GitHub Sponsors](https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors) takes no fee for personal accounts.
- **The target ecosystem is TypeScript.** [Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/) reports that TypeScript became GitHub's most used language in August 2025, which GitHub partly attributes to AI-assisted coding.

## Assessment of The Forge

### Strengths

- **The agent protocol is unusually rigorous.** Every command is non-interactive and returns one JSON envelope, with stable exit codes, `--dry-run`, SHA-256 `--if-match` and path containment. This serves "give the agent a check it can run", and the `schema --json` catalogue is small enough to load just in time.
- **The workflow templates encode good epistemics.** They carry stable REQ/UC/T IDs, label evidence as observed, assumed or not run, record unknowns as TBD, and add a "Next artifact" hand-off. The stage prompts forbid invented test results or deployments. This anticipates Böckeler's "false sense of control" critique.
- **The idea-to-production pack is concrete.** It includes filled artifacts, prompts, component and data-source fixtures, and a release ledger.
- **Claude Code management is deep.** It validates 33 hook events and agent frontmatter, guards revisions on `.claude/settings.json`, and supports dry runs.

### Gaps

1. **The time to first value is long.** The README quickstart has 19 commands. Install means a `main` tarball plus manual `cp` and `rm` resets, and those reset instructions are repeated in three documents. There is no published release, no checksums and no signature. The workspace-with-`projects/` model does not match the dominant job, which is adding the tool to the repository you already have.
2. **There is no loop around the templates.** There is no tasks artifact with IDs and status, no change or feature folder, no bugfix or quick-change track and no ADR template. Above all, there is no check that every REQ has a use case, a task and a test. Competitors scale ceremony to change size; The Forge offers one heavyweight path.
3. **The first tutorial never involves an agent.** "Getting started" ends with a dry-run entity preview. An agent-first product should end its first ten minutes with an agent having done something safely.
4. **The skills default misses Claude Code.** The default `.agents/skills` is not a documented Claude Code location. The skills are not packaged as a Claude plugin or marketplace, nor in an `npx skills add`-compatible repository.
5. **Claude management is single-vendor and tracks a moving target.** The 33-event hook list and the agent field list will churn with upstream releases. It overlaps the native `/hooks` and `claude plugin` commands.
6. **The scope is diffuse.** UI generation for seven frameworks, Storybook, forms, data sources, Bases evaluation and vault editing compete for one maintainer's attention.
7. **Trust signals are missing for adoption.** There are no releases, no Windows or macOS CI, no CONTRIBUTING, roadmap or issue templates, and no users yet.

## Recommendations

| ID | Recommendation | Priority | Effort | Rationale and evidence |
| --- | --- | --- | --- | --- |
| WA-1 | Choose the persona and one job to be done: "make AI-assisted changes traceable and safe in an existing TS repo". Mark UI, forms, data-source and Bases features as secondary or experimental in the README and docs hub. | P0 | S | A diffuse scope hurts discoverability and agent tool selection ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). DORA says process quality decides outcomes. |
| WA-2 | Publish versioned releases: an npm package with provenance through trusted publishing, plus GitHub Release tarballs with SHA-256 checksums. Document `npx <pkg>@<version>` as the primary install and keep the "copy `bin/`" route for air-gapped use. | P0 | M | Every competitor installs with one command ([OpenSpec](https://github.com/Fission-AI/OpenSpec), [Ruler](https://github.com/intellectronica/ruler), [Spec Kit](https://github.com/github/spec-kit)). Provenance is the low-cost trust signal ([npm](https://docs.npmjs.com/generating-provenance-statements)). |
| WA-3 | Add an `init` mode that adopts the current repository as the workspace and project, without a `projects/` directory or manual config/context reset. It should preview with `--dry-run` and never overwrite. Collapse the three copies of the reset instructions into one. | P0 | M | Gap 1. Current loops are repo-local (AGENTS.md, `.claude/`, `.agents/`). |
| WA-4 | Decide the name before the first public release. If The Forge is kept, use a distinctive package and skill prefix and avoid bare `forge-*` skill IDs. Otherwise rename to something searchable and claim the npm, GitHub and domain names together. | P0 | S | Collisions with Atlassian (which has a Claude plugin), Foundry, Laravel and ForgeCode (an AI agent and Spec Kit integration). `agent-cli` is taken on npm. |
| WA-5 | Install skills into every agent's native location: `--target claude,codex,all`, writing `.claude/skills/<id>/SKILL.md` and `.agents/skills/<id>/SKILL.md`, with `all` as the default in `init`. | P0 | S | [Claude skill paths](https://code.claude.com/docs/en/skills) and [Codex skill paths](https://learn.chatgpt.com/docs/build-skills) differ. |
| WA-6 | Add a deterministic `trace check` that parses REQ/UC/T/TASK IDs across planning docs and reports orphans, missing tests and stale statuses as JSON with a non-zero exit. Ship an example Stop-hook or CI recipe that runs it. | P1 | M | It turns the templates into a verifiable loop. Verification is the highest-leverage practice ([best practices](https://code.claude.com/docs/en/best-practices)), and review is the bottleneck ([Faros](https://www.faros.ai/blog/ai-software-engineering)). No SDD tool surveyed offers a deterministic traceability gate. |
| WA-7 | Add right-sized tracks: a one-page "change" template that combines intent, acceptance examples and tasks, plus ADR and bugfix templates. Document when to use the full PRD-to-release pack. | P1 | S | SDD over-ceremony critique ([Böckeler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)), [Kiro Quick Spec and bugfix specs](https://kiro.dev/docs/specs/), BMAD's "small changes go straight to build". |
| WA-8 | Make the first tutorial agent-first. Provide one prompt to paste into Claude Code or Codex that uses the Forge skill to draft a change spec with `--dry-run` and then `--if-match`, followed by `trace check`. Move caveats into a short "Limits" box. | P1 | S | DevEx feedback loops. [Show HN](https://news.ycombinator.com/showhn.html) requires people to be able to try it. |
| WA-9 | Package the Forge skills (and optionally a hook recipe) as a Claude Code plugin in a repository marketplace, in a layout compatible with `npx skills add`. | P1 | S | This is how teams distribute and govern agent configuration ([marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), [Vercel skills](https://vercel.com/docs/agent-resources/skills)). |
| WA-10 | Freeze the `claude` command group's surface and position it as validation and governance (`check`, drift, guarded edits). Keep a documented upstream-version compatibility note and avoid extending the hook and field lists ahead of user demand. | P1 | S | Upstream churn, overlap with native CLI commands, single-maintainer cost. |
| WA-11 | Add launch hygiene before any announcement: CONTRIBUTING, a public ROADMAP, issue and discussion templates, a CHANGELOG, macOS and Windows CI smoke tests, and GitHub Sponsors. Recruit 3–5 design partners before a Show HN. | P1 | M | Trust signals. [Sponsors charges no fees for personal accounts](https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors). There is no user evidence yet. |
| WA-12 | Publish a short comparison page: The Forge versus Spec Kit, OpenSpec and Ruler, and how to use them together (for example, Forge as the guarded write and trace layer under any SDD framework). | P2 | S | Clear positioning in a crowded category. Complementing these tools is safer than competing with them. |
| WA-13 | Offer opt-in, local-only feedback (`feedback` printing a prefilled issue URL) instead of telemetry. | P2 | S | Keeps the no-telemetry promise while gathering adoption signals. |

## Suggested first-10-minutes flow

The target is an existing TypeScript repository and a user who already runs Claude Code or Codex. It assumes WA-2, WA-3, WA-5 and WA-6 have shipped.

1. **0:00–1:00, install and orient.** Run `npx <pkg>@0.x init --dry-run`. One JSON response lists the planned files: AGENTS.md section, skills in `.claude/skills` and `.agents/skills`, and `planning/` templates. Run `init` to apply it.
2. **1:00–2:00, confirm scope.** `<pkg> project current --json` shows the repository root as `context.root`, so the user sees where writes will land.
3. **2:00–5:00, the agent drafts a change.** The user pastes the provided prompt into the agent, for example: "Use the forge-workflow skill to draft a change spec for <feature> with three acceptance examples; preview, then create." The agent runs `make document --template change.md --dry-run`, shows the preview, and writes the file. A second edit uses `--if-match`, which shows a guarded write in practice.
4. **5:00–7:00, the aha moment.** Run `<pkg> trace check --json`. It reports `REQ-002 has no test` with exit code 2. The agent adds the test entry and the re-run passes.
5. **7:00–9:00, govern.** Run `<pkg> claude hooks add Stop --from recipes/trace-stop.json --dry-run`, then apply it. Every future agent turn now ends with the traceability gate.
6. **9:00–10:00, next steps.** Link to right-sized tracks, Spec Kit/OpenSpec interop and the idea-to-production pack.

## What not to build

- **An agent runtime, chat UI, IDE extension or model integration.** Claude Code, Codex and Copilot own these, and the CLI-plus-skills route is already the most context-efficient option ([best practices](https://code.claude.com/docs/en/best-practices)).
- **A cross-vendor configuration sync engine.** Ruler and rulesync already cover about 30 agents. Interoperate with them instead.
- **More UI framework targets, more Storybook features or "spec-as-source" regeneration.** Böckeler's MDD warning applies, and every such target multiplies maintenance with no user evidence of demand.
- **An MCP server or daemon before users ask for one.** The JSON CLI already serves agents, and an MCP server would add a second protocol for one maintainer to support.
- **Telemetry, hosted SaaS or commercial tiers before adoption.** Stay MIT with Sponsors; consider paid support or template packs once design partners exist.

## Open questions

1. Is the primary user the human tech lead or the agent itself?
2. How central is Obsidian? If it is peripheral, vault-specific features could move to a plugin to shrink the core.
3. Will the maintainer commit to npm publishing and semantic versioning? WA-2 and WA-3 depend on it.
4. Is a rename acceptable before v0.1.0? It is much cheaper now than after users arrive.
5. Should the workflow pack interoperate with Spec Kit or OpenSpec file layouts, for example by reading their `tasks.md` IDs in `trace check`?
6. What evidence would justify keeping the seven-framework UI generator?

## Sources

- DORA 2025, Google blog: https://blog.google/technology/developers/dora-report-2025/
- DORA 2025, InfoQ: https://www.infoq.com/news/2025/09/dora-state-of-ai-in-dev-2025
- Stack Overflow Developer Survey 2025, AI: https://survey.stackoverflow.co/2025/ai
- METR 2025 study: https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- METR 2026 update: https://metr.org/blog/2026-02-24-uplift-update/
- Faros AI Productivity Paradox: https://www.faros.ai/blog/ai-software-engineering
- GitHub Spec Kit repo: https://github.com/github/spec-kit
- Spec Kit site: https://github.github.com/spec-kit/
- OpenSpec: https://github.com/Fission-AI/OpenSpec
- BMAD Method: https://github.com/bmad-code-org/BMAD-METHOD
- Kiro specs: https://kiro.dev/docs/specs/
- Böckeler, SDD tools: https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Claude Code memory and AGENTS.md: https://code.claude.com/docs/en/memory
- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Codex skills: https://learn.chatgpt.com/docs/build-skills
- Agent Skills standard: https://agentskills.io/home
- AGENTS.md: https://agents.md/
- Anthropic, context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Chroma, context rot: https://www.trychroma.com/research/context-rot
- Claude Code Action: https://github.com/anthropics/claude-code-action
- Copilot coding agent: https://docs.github.com/en/copilot/using-github-copilot/coding-agent/using-copilot-to-work-on-an-issue
- Ruler: https://github.com/intellectronica/ruler
- Vercel skills CLI (seen in search results): https://vercel.com/docs/agent-resources/skills
- ADRs and agents (secondary): https://duncandavidson.com/agents-love-decisions ; https://blog.thestateofme.com/2025/07/10/using-architecture-decision-records-adrs-with-ai-coding-assistants/
- DevEx framework (fetch blocked; secondary): https://queue.acm.org/detail.cfm?id=3595878 ; https://www.infoq.com/articles/devex-metrics-framework
- Atlassian Forge: https://developer.atlassian.com/platform/forge/
- Atlassian Forge Claude plugin: https://claude.com/plugins/atlassian-forge-skills
- Foundry forge: https://getfoundry.sh/forge/overview
- ForgeCode: https://forgecode.dev/docs (search result; direct fetch returned 404)
- Show HN rules: https://news.ycombinator.com/showhn.html
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
- GitHub Sponsors: https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors
- Octoverse 2025: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
- npm registry name checks (2026-10-10): https://registry.npmjs.org/agent-cli , https://registry.npmjs.org/forgecode , https://registry.npmjs.org/the-forge
