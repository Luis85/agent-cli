# Agent-first CLI review and polishing pass

Reviewed 2026-10-11 against remote `main` at `a97411aac260fd8b7beec561e284600b7c1f18a2` (PR #18). The checkout initially matched that commit and was clean. This report supersedes older research where it describes the current implementation. Maintainer research is not packaged into the portable distribution.

## Product assessment

The Forge already has a coherent foundation for AI-first product development: a noninteractive JSON interface over ordinary files, explicit project scope, discoverable command contracts, revision-guarded changes, and verifiable generation. The highest-value work is making those existing guarantees easier to discover and reliable at their boundaries. This pass adds no commands, integrations, generators, runtime dependencies or background services.

Six parallel reviews covered agent contracts, onboarding, reliability, security, extensibility and release quality. The integration review covered Unicode paging, source architecture, existing workflow coverage and combined delivery. Reviewers independently cross-checked transactional, security and help changes. Findings below are based on source inspection, executable reproductions and targeted regression tests; they are not a claim that every possible defect has been found.

| Perspective | Main finding and action |
| --- | --- |
| Agent usability and context cost | Default help repeated response schemas and the envelope. Reduced it to a command index with descriptions, usage and behavior hints; targeted help retains inputs, and `schema` retains the complete machine contract. |
| First use and adoption | The introductory path toured unrelated generators before completing a basic task. Replaced it with setup, explicit project selection, preview, create, read, guarded edit and validation. |
| Product and engineering workflow | Existing editing, search, links, backlog, generation and verification surfaces are sufficient for this scope. Improved their shared CLI and persistence contracts rather than expanding the feature surface. |
| Trust and data integrity | Found mutable batch inputs, incomplete rollback cleanup, misleading preview diffs and a late-created Git protection gap. Fixed each with an observable regression. |
| Security and portability | Reserved paths and protected roots missed case variants or Windows aliases. Unified their protection and corrected overlapping credential redaction in evaluation reports. |
| Extension author experience | Runtime plugin callbacks provide settings/services/localization, but TypeScript inferred the narrower kernel context. Corrected SDK inference and isolated faulty settings validators. |
| Reliability measurement | A headless agent result marked as failed could still receive a passing score. Evaluation now requires successful agent completion as well as passing checks. |
| Distribution and operations | Archive bytes depended on accidental source execute bits. Normalize staged asset modes while preserving the executable launcher. |
| Internationalization | Cursor fingerprints discarded half of supplementary Unicode characters. Different emoji queries could share a cursor; hash all UTF-16 code units. |
| Documentation and maintenance | Corrected portable-bundle requirements, skill-update instructions, plugin setup and historical research labels. Existing architecture and quality gates remain authoritative. |
| UI and accessibility | This pass targets the CLI. No visual redesign or new UI was introduced; generated framework/form behavior remains covered by existing automated tests. It does not establish visual or assistive-technology conformance in Obsidian or a browser. |

## Findings resolved

P1 denotes a confirmed integrity, protection or isolation problem; P2 denotes an existing workflow, correctness or delivery problem. Priorities reflect these reproductions, not speculative attack scenarios.

| Priority | Reproduction on the reviewed implementation | Resolution and evidence |
| --- | --- | --- |
| P1 | An `operation.started` listener changes a mixed batch's paths, bytes or removals while `Workspace.commit` awaits notification. The eventual mutation differs from the submitted plan. | Snapshot writes, renames, removals and preview/trash options before asynchronous work. Lifecycle integration tests mutate each caller-owned input and verify original destinations and bytes. |
| P1 | Add `.git` after folder preflight but before rename/remove verification. Folder revisions deliberately omit Git data, so revision comparison alone permits the operation. | Recheck Git protection during immediate verification. Injected tests cover both move and removal and verify `PROTECTED_PATH`. |
| P1 | Reserved `.GIT`, lock/temp case variants, and Windows trailing-dot/space aliases bypass literal name guards. Recursive protection and protected root checks have similar gaps. | Normalize reserved-name comparisons, consistently exclude internal entries, protect Git/dependency trees and protected roots, and reject ASCII DEL. Deterministic path and filesystem tests cover variants without relying on the host being case-insensitive. |
| P1 | Evaluation credentials share a prefix; replacing the short credential first leaves the longer credential's suffix in the report. | Redact longest values first. Tests cover both environment insertion orders using synthetic credentials. |
| P2 | A moved folder receives new nested output folders, then a later write fails. Rollback moves those empty folders back into the original tree. | Remove created empty directories before and after reversing renames; verify original tree and folder revision. |
| P2 | An edit transform modifies its input bytes in place. The old snapshot changes too, so the dry-run diff appears empty. | Give transforms detached bytes. Test both truthful preview and committed content. |
| P2 | `--help` emits 215,232 UTF-8 bytes in this checkout; the workflow skill directs agents to the entire schema for routine tasks. | Separate concise help from schema output, and recommend command-specific discovery. Contract tests ensure schemas remain complete and are not mutated by help. |
| P2 | A trailing `--json` is applied after enum/routing validation, so invalid input ignores the requested output formatting. | Apply parsed output preference before semantic validation. Portable tests cover compact and pretty errors for enum, required-option, event and language failures. |
| P2 | A plugin callback using the documented `satisfies Omit<Plugin, 'manifest'>` pattern cannot access `context.settings` without a cast. | Infer `PluginContext` for plugin command and generator contributions while retaining kernel context defaults. Compile-checked integration coverage uses settings, services and localization without casts. |
| P2 | A plugin settings validator throws, returns malformed values or returns a rejected Promise. It can abort the entire invocation. | Diagnose the plugin's settings as invalid, handle rejected async returns, and preserve discovery and healthy plugins. Tests also prevent stale configured settings and sparse issue arrays. |
| P2 | An agent returns the correct answer but a failed/max-turns result event. Acceptance checks pass and the evaluation incorrectly reports success. | Require a successful result event; regression preserves passing task checks while asserting a failed overall run. |
| P2 | Changing a packaged README/runtime execute bit changes otherwise identical release archives. | Stage assets as `0644`, retain launcher `0755`, and compare archive bytes after changing source permissions. |
| P2 | A cursor issued for `😀` is accepted for `😁` because fingerprinting uses only the first surrogate. | Hash every code unit and test same-query continuation plus cross-query rejection. |
| P2 | Onboarding omits the runtime bundle in places, suggests repeating a write to retrieve events, and overstates rollback guarantees. | Require the complete bundle; collect events on the original invocation; describe `ROLLBACK_FAILED` inspection, shared project selection and revision-guarded skill refresh. A 30-invocation isolated walkthrough verifies the documented path. |

Sparse rename/removal arrays now fail with `INVALID_PLAN` instead of an incidental runtime exception. These are validation fixes to existing contracts.

## Research and application

The research supports improving tool boundaries and documentation before adding capabilities:

- [Command Line Interface Guidelines](https://clig.dev/) recommend composability, discoverable help, appropriate output volume and actionable failures. Applied to a machine-first CLI, this means retaining JSON and avoiding prompts while making the initial catalog smaller and error formatting consistent.
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) emphasizes clear tool definitions, meaningful responses, context efficiency and evaluation. This informed targeted discovery, truthful dry-run output and the correction to false-positive evaluation results.
- [Agent Skills specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx) describes progressive disclosure. The workflow skill now directs routine tasks to relevant contracts and documents rather than the full inventory.
- [MCP ToolAnnotations reference](https://modelcontextprotocol.io/specification/2025-06-18/schema#toolannotations) treats behavioral annotations as hints. Forge preserves its existing read-only, destructive and idempotency hints in help; the actual guards and regression tests establish behavior. No MCP server was added.

These are design references, not evidence of measured user adoption or model performance. The applied choices are specific to Forge's existing contracts and agent-first direction.

## Verification

Discovery output measured on the same checkout with all bundled plugins enabled:

| Invocation | Before (UTF-8 bytes) | After (UTF-8 bytes) |
| --- | ---: | ---: |
| `--help` | 215,232 | 21,572 |
| `help --json` | 109,647 | 15,752 |
| `help read --json` | 3,157 | 1,740 |
| `schema --json` | 383,126 | 383,126 |
| `schema read --json` | 10,398 | 10,398 |

Default help is approximately 90% smaller. These are byte counts, not model-token or latency measurements. Full schemas retain their existing content and shape, as checked by the schema contract tests.

An existing metadata benchmark (`npm run bench -- --runs 1`) also completed on a synthetic vault of 2,000 notes, 100 attachments and one Base. Vault checking, unresolved links, filtered search and Bases queries all succeeded without warnings or warm-cache rewrites. Warm wall times were 303, 234, 473 and 367 ms respectively; cold wall times ranged from 1.80 to 2.28 seconds. This single local run is a smoke check, not a before/after performance claim or a cross-platform benchmark.

Validation ran on Linux with Node 24.19.0. The showcase's independent `npm ci` and `npm run check` passed, including 27 tests across 11 files; regeneration and `showcase:check` matched all 272 generated files. Workflow synchronization reports all three generated workflows unchanged. The checkout's tracked configuration and selected project are unchanged.

The final Forge `npm run check` passed: structure, lint, unused-code analysis, source/test type checking, portable build and packaging, **2,550 tests across 243 files**, and showcase drift verification. This includes the 33 existing reference evaluation tasks, portable distribution/release checks, schema contracts, architecture boundaries and generated-framework coverage. The showcase adds **27 passing tests across 11 files**. `git diff --check` also passed.

The first combined run identified an old skills test expecting response schemas in help; it now compares all shared fields exactly and explicitly verifies the schema-only fields. Regeneration refreshed only the showcase's two copies of the workflow skill. No checks were weakened. Build output retains non-fatal upstream Zod annotation warnings from Rollup.

All source, tests, packaged assets and generated showcase changes must be reviewed together. No remote service credentials or real user vaults were needed for these regression checks. Windows, macOS and the minimum supported Node version were not separately executed in this session; their existing CI matrix remains required.

## Remaining boundaries

- Project selection is persistent and shared by invocations. Documentation now explains coordination and separate workspaces for concurrent agents needing different projects. This pass does not add a new global project-routing flag.
- Plugins execute trusted Node code. Validation isolation improves plugin failure handling; it does not sandbox malicious plugins.
- Multi-file operations roll back reported errors but are not crash-atomic. External editors do not honor Forge's writer lock. `ROLLBACK_FAILED` still requires inspecting actual state.
- A real authenticated agent evaluation and live Azure DevOps/Claude service integration are separate from deterministic fixture coverage. No adoption or real-model success-rate claim is made here.
- Validation of native file structure and generated framework code does not prove Obsidian rendering or every community plugin's semantics. The existing format/capability documents remain the contract.
- Full localization, extra connectors, distribution channels and persistent audit infrastructure remain outside this polishing scope. Historical roadmap proposals should not be mistaken for new commitments.

The compact help shape intentionally changes before the first release: callers needing full command output schemas or the response envelope should use `schema`. The command set and guarded-write model remain the same.
