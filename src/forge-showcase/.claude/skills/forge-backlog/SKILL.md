---
name: forge-backlog
description: Plan, decompose, rank, release and sync a product backlog stored as Obsidian Product Backlog (backlog-view) compatible notes with the backlog command, including two-way Azure DevOps Boards sync. Use when the user mentions backlog items, epics, features, PBIs, tasks, ranks, iterations, releases or work item sync.
license: MIT
compatibility: Requires Node.js 22.12 or newer and The Forge distribution in the workspace bin folder.
metadata:
  author: The Forge
  version: "0.1.0"
---

The `backlog` command manages a backlog that the Obsidian Product Backlog view opens unchanged. The `.base` file's `product-backlog` view options say which properties hold parent, order, type, state, dates, iteration, release and dependencies.

- Never edit backlog frontmatter with `properties` or `write`: the backlog command keeps the plugin's ranks, stamps, refusals and YAML style.
- Preview every change with `--dry-run`; `data.changes[].diff` shows the exact note.

## Start
- `backlog check` or `backlog list` finds the backlog. With none yet, `backlog init --folder docs/backlog` writes `Product Backlog.base`; bind the properties you need in the view options and add a `product-release` view for releases.
- Several backlogs need `--base <file> --view <name>` (or `plugins.settings.backlog.base`). `BACKLOG_AMBIGUOUS` lists `error.details.candidates`.

## Read
- `backlog tree` (hierarchy), `backlog list` (global rank; `context: true` rows are read-only ancestors), `backlog board` (columns by state), `backlog show <item>`.
- Name items by vault path, title, link text or `pbl-id` (`#12`).

## Plan
- Decompose top-down: Epic → Feature → PBI → Task. `backlog add Epic "Trip planning"`, then `backlog add Feature "Route sharing" --parent "Trip planning"`.
- Issue, Bug, Idea, Deliverable and Improvement hang under any rung above Task; Milestone, Iteration and Release are markers. A root of an unknown type would be hidden, so `add` refuses it without `--parent` (`BACKLOG_WRITE_REFUSED`, `details.reason: hidden-type`).
- Rank: `backlog move <item> --before <sibling>`, `--after`, `--first`, `--last`, `--parent <item>` or `--top`. On `BACKLOG_NO_GAP`, run `backlog ranks respace` (or `ranks seed`) and move again.
- Track: `backlog set <item> --state Active` stamps `started` and `finished`; also `--priority`, `--risk`, `--horizon`, `--start`, `--due`, `--assignee`, `--type`. An empty value (`--horizon ""`) deletes the key.
- Dependencies: `backlog depend <item> --on <prerequisite>` refuses loops; `backlog undepend <item> --on <prerequisite>` removes one.
- Iterations: `backlog iteration add --goal "Share a route"`, `backlog iteration assign <item> <iteration>`.
- Releases: `backlog release add "1.0" --release-version 1.0.0 --target-date 2026-12-01`, `release join <item> <release>`, `release readiness <release>`, `release notes <release>`, `release mark-released <release>`.
- Pass `--today YYYY-MM-DD` for reproducible stamps.

## Finish
- `backlog check`: `ok: false` lists errors such as cycles, broken links and fields a type may not hold; warnings cover rank ties, unranked items and `ignored` notes the view hides.
- `BACKLOG_WRITE_REFUSED` carries `details.reason` (`outside-filter`, `field-not-held`, `not-a-release`, `dependency-cycle`, `unbound-property`, `hidden-type`). `BACKLOG_CONFIG_PROBLEM` means two roles share one property or a release option is missing.

## Reference
- [Sync with Azure DevOps](references/sync.md): connections, tokens, `backlog sync` status, conflicts and recovery codes.
