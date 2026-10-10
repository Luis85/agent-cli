# Product research

Researched 2026-10-10 · Maintainer material, not packaged into `bin/data/docs`; it does not define runtime contracts.

This research asks four questions about The Forge at v0.1.0. What can it help with today? Where is it lacking? What should improve? What should be added? Seven research passes each took one product perspective and surveyed the 2025–2026 landscape on the web. Each pass then compared The Forge against that landscape and proposed prioritized recommendations. This page synthesizes the passes for planning the next iteration. The perspective reports hold the evidence and sources. The maintainer then set the direction: The Forge is a terminal project companion, the agent's independent interface to an Obsidian-compatible vault. The [next iteration plan](10-next-iteration-plan.md) turns that direction into milestones. It supersedes the positioning options and roadmap candidates below wherever they differ.

| # | Report | Perspective | Recommendations |
| --- | --- | --- | --- |
| 01 | [Competitive landscape and positioning](01-competitive-landscape.md) | Official Obsidian CLI, vault MCP servers, scaffolders, spec-driven tools, Claude config managers | CL-1 to CL-11 |
| 02 | [Agent experience and interfaces](02-agent-experience.md) | The agent as the primary user: response cost, contracts, errors, missing primitives, CLI versus MCP | AX-1 to AX-16 |
| 03 | [Knowledge vaults and agent memory](03-knowledge-and-vaults.md) | Obsidian parity, link integrity, search, Bases, Markdown-as-memory | KV-1 to KV-14 |
| 04 | [Code and UI generation](04-code-and-ui-generation.md) | Deterministic codegen, cross-framework UI, design tokens, Storybook, forms, data adapters | CG-1 to CG-12 |
| 05 | [Security, safety and trust](05-security-and-trust.md) | Threat model, write durability, Claude settings risk, plugin and supply-chain trust | ST-1 to ST-13 |
| 06 | [Distribution, operations and platform](06-distribution-and-platform.md) | Install, upgrade, cross-platform, performance, plugin ecosystem, observability | DP-1 to DP-15 |
| 07 | [Engineering workflow and adoption](07-workflow-and-adoption.md) | AI-assisted SDLC, context engineering, onboarding, naming, open-source go-to-market | WA-1 to WA-13 |
| 08 | [Obsidian event model](08-obsidian-event-model.md) | Reference: vault, metadata cache, workspace and lifecycle events from `obsidian.d.ts` | none |
| 09 | [backlog-view compatibility contract](09-backlog-view-contract.md) | Reference: on-disk format and write rules of the backlog-view plugin | none |
| 10 | [Next iteration plan](10-next-iteration-plan.md) | Product direction, kernel and core-plugin architecture, event parity, milestones M1–M6 | none |

## What The Forge helps with today

The reports independently converge on one combination that no surveyed tool offers. The Forge makes **guarded, previewable, machine-readable writes to Markdown, Canvas and Bases files without a running application**. Its building blocks:

- SHA-256 `--if-match` on every overwrite and `--dry-run` on every mutation.
- One JSON envelope with stable exit codes, path containment and a writer lock.
- A standalone Bases evaluator.

The official Obsidian CLI, shipped in desktop 1.12 in February 2026, needs the app running. Its documentation describes no dry-run or revision guard ([01](01-competitive-landscape.md), [03](03-knowledge-and-vaults.md)). The vault MCP servers surveyed document no optimistic concurrency. Spec-driven frameworks such as Spec Kit, OpenSpec, BMAD and Kiro have no guarded write layer beneath their documents ([07](07-workflow-and-adoption.md)).

Secondary strengths:
- Deterministic UI and data-source generation with drift checks (exit 5).
- Explicit project scope reported in every response.
- Revision-guarded editing of Claude Code agents, hooks and plugin assets.
- A disciplined architecture and quality gate.

## Where it is lacking

The reports raise these gaps repeatedly:

1. **Positioning is diffuse.** The CLI has 24 top-level commands, which span vault editing, DDD scaffolds, seven UI targets, forms, data sources, workflow templates, plugins and Claude management. One maintainer with no users yet maintains all of it. Most of the non-vault surface overlaps with much larger projects, including Mitosis, shadcn, Nx, projen, Spec Kit, OpenSpec, BMAD, rulesync and Claude Code's own plugin CLI ([01](01-competitive-landscape.md), [04](04-code-and-ui-generation.md), [07](07-workflow-and-adoption.md)).
2. **Table-stakes vault operations are missing.** There is no search, delete, move or rename with link rewriting, and no backlinks, unresolved-link or orphan reports. The link index needed for these already exists inside `bases query`, but no command exposes it ([03](03-knowledge-and-vaults.md), [02](02-agent-experience.md)).
3. **Responses cost agents tokens and still leave guesswork:**
   - Lifecycle `events` take about 58% of a small response.
   - `read` returns both `content` and `body`.
   - UTF-8 code files such as `.ts`, `.json` and `.yaml` come back as base64 attachments. Agents therefore bypass Forge's guards for code.
   - `schema` types options only as `string` or `boolean`, with no descriptions, enums, output schemas or error lists.
   - Over 100 error codes exist in source, but only 12 are documented ([02](02-agent-experience.md)).
4. **Install and upgrade are manual.** Users copy `bin/` from a tarball of `main` and reset config by hand. There is no npm package, tagged release, signature, SBOM, `upgrade`, config migration or `doctor` ([06](06-distribution-and-platform.md), [05](05-security-and-trust.md), [07](07-workflow-and-adoption.md)).
5. **Trust stops at the write call:**
   - Writes are not fsynced, and the lock file records no owner.
   - Nothing records an audit trail or supports undo.
   - Plugins are enabled by ID with no content pinning.
   - Claude settings that can execute code (hooks, `env`, `apiKeyHelper`, marketplaces) get the same treatment as Markdown edits ([05](05-security-and-trust.md)).
6. **Scale and platforms are unproven.** `bases query` is O(n²): 9 s at 1,000 notes and 142 s at 5,000 in measurement. The cause is a per-row evaluation context built over every indexed file (`src/the-forge/infrastructure/bases/engine.ts:89`). CI runs on Ubuntu only, with no line-ending policy ([06](06-distribution-and-platform.md)).
7. **Interoperability lags the standards agents already read.** Skills are not laid out as Agent Skills folders and install only to `.agents/skills`, while Claude Code reads `.claude/skills`. UI output emits no shadcn registry, Custom Elements Manifest or design tokens. Data sources do not import OpenAPI. Forms do not use Standard Schema ([02](02-agent-experience.md), [04](04-code-and-ui-generation.md), [07](07-workflow-and-adoption.md)).

## The central decision: positioning

The reports propose two compatible positions. The next iteration should pick one as the lead.

| Candidate | Statement | Champion | Implication |
| --- | --- | --- | --- |
| A. Vault write layer | "The safe, headless write layer for Obsidian-format vaults, built for coding agents and CI." | [01](01-competitive-landscape.md), [03](03-knowledge-and-vaults.md) | Vault parity work (search, move with link rewriting, links, lint) is P0. Generators become optional plugins or example packs. |
| B. Traceable agent changes | "Make AI-assisted changes traceable and safe in an existing TypeScript repo." | [07](07-workflow-and-adoption.md) | `init` for existing repos, multi-target skills, `trace check` plus a Stop hook, and right-sized templates are P0/P1. The vault is the substrate for specs. |

Both share the same core: guarded writes, a JSON contract and a dry-run/plan/check discipline. The difference is the front door. Position A competes directly with the official Obsidian CLI and the vault MCP servers on safety. Position B competes with spec-driven frameworks as the deterministic layer beneath them. A combined pitch is plausible: a guarded write and trace layer for agent-maintained Markdown, whether that Markdown holds notes, specs or memory. That pitch only works if the README leads with one job.

## Consolidated candidates for the next iteration

The table merges overlapping recommendations across the reports. "Sources" lists the original IDs; their rationale and evidence live in the linked reports.

### Now: foundation, whichever position wins

| Candidate | Sources | Effort |
| --- | --- | --- |
| Pick the persona and position; rewrite the README lead, help summary and skills around it; demote secondary surfaces | CL-1, WA-1, CG-1 | S |
| Settle the name before any public release (crowded "forge" namespace; `agent-cli` is taken on npm) | WA-4 | S |
| Make responses lean: opt-in lifecycle events, no duplicated `read` output, a `text` kind for UTF-8 files with `edit` support | AX-1, AX-2, AX-3 | S–M |
| Make Bases queries linear and add a scaling budget test | DP-1 | M |
| Durable writes (fsync file and directory) and lock owner metadata with stale-lock diagnosis | ST-1, DP-8 | S |
| Gate execution-bearing Claude settings behind an explicit flag, and redact secrets in responses | ST-2, ST-5 | M |
| Verifiable releases: tag-triggered GitHub Release (tar.gz and zip), checksums, attestations, SBOM, SHA-pinned actions; npm with trusted publishing and `npx` install | ST-3, DP-2, DP-3, WA-2, CL-3 | M |
| Windows and macOS CI, `.gitattributes` line endings | DP-6, CL-8 | S |

### Next: the product's core verbs

| Candidate | Sources | Effort |
| --- | --- | --- |
| `search` (literal or regex, filters, line and snippet hits) plus paging on `list` | KV-4, AX-6, CL-2, DP-12 | M |
| `links` group (out, back, unresolved, orphans) on the existing index | KV-3, AX-9, CL-2 | S |
| Guarded `delete` and link-rewriting `move`/`rename` | KV-1, KV-2, AX-9, CL-2 | M–L |
| Unified diff in every dry-run and conflict response; `--if-match` allowed on dry runs | AX-7, CL-4 | S |
| Multi-edit and `apply <plan.json>` multi-file batches | AX-8 | M |
| `schema` as JSON Schema with output schemas, annotations and per-command error lists; full error catalog with hints | AX-4, AX-5 | M |
| Stateless `--project` on every scoped command | AX-10 | S |
| `init` that adopts the current repository; `upgrade` and `config migrate` | WA-3, DP-4, DP-5 | M |
| Skills as spec-compliant folders, installed to Claude and Codex locations, also shipped as a Claude Code plugin | AX-11, CL-6, WA-5, WA-9 | S |
| Agent evaluation harness: 20–30 tasks run through real agents with state verification | AX-12 | M |
| Position-dependent: `vault check` lint, tag and property inventories, section-targeted edits, `bases query --rows`. Or `trace check` with a Stop-hook recipe and right-sized change, ADR and bugfix templates | KV-5–KV-9, WA-6, WA-7 | M |

### Later: differentiators and ecosystem

| Candidate | Sources |
| --- | --- |
| Policy file, opt-in hash-chained audit log, undo and recovery journal | ST-7, ST-8, ST-9, AX-16 |
| Thin MCP stdio adapter generated from the command registry, after the schema contract and evaluation harness exist | CL-5, AX-14, DP-11 |
| Plugin content pinning, `forgeApi` compatibility ranges, `doctor` | ST-4, DP-9, DP-10 |
| Generation gap ownership model, accessible stories by default, OpenAPI import, MSW handlers, design tokens, registry/manifest export, Standard Schema forms | CG-2–CG-8 |
| Bases conformance suite against Obsidian's `base:query` | CL-7 |
| Memory profile skill, daily notes, tasks parsing | KV-10–KV-12 |
| Compile cache and lazy modules, local trace export, persistent index or watch | DP-7, DP-13, DP-15 |
| Launch hygiene (SECURITY.md, CONTRIBUTING, roadmap, changelog) and 3–5 design partners before announcement | ST-10, WA-11 |

## What not to build

The reports agree on these exclusions:
- A home-made plugin sandbox or prompt-injection detector.
- Bundled embedding models or vault sync.
- Executing Dataview or Templater code.
- Auto-update or remote telemetry.
- Bun or Deno as the primary build, or a move to oclif.
- More UI targets or form field types ahead of demand.
- An MCP server before the schema contract, policy and evaluation harness exist.

Several reports also advise freezing the `claude` command group's surface rather than tracking every upstream hook and field.

## Verification notes and limits

During synthesis I re-checked several codebase claims directly:
- `read x.ts` returns `kind: "attachment"` with base64 content.
- `read` on a Markdown note returns both `content` and `body`.
- `engine.ts:89` constructs an evaluation context per row with the full indexed file list.

The timings and response-size percentages are the research agents' own measurements on synthetic vaults with Node 22 on Linux. The secret-exposure finding for `claude hooks inspect` was inferred from documentation and not tested.

External claims come from web sources dated through October 2026. Each report marks claims seen only in search summaries as unverified. Star counts are approximate. No user interviews, usage data, or native Windows/macOS runs inform this research. Persona and priority calls are informed judgment, not validated demand.
