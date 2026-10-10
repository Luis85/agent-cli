# Plan and release work in a product backlog

[Documentation](../index.md) · How-to guide

Use this guide to set up a backlog that the Obsidian Product Backlog view (backlog-view) shows, decompose work into it, rank and track it, and ship it in iterations and releases. Every option, field and refusal is specified in the [backlog reference](../reference/backlog.md). The [showcase](explore-the-showcase.md) contains a complete Trailhead backlog built with these commands.

## Create the backlog

Scaffold the base the way the plugin's "Create backlog" command does, then bind the properties you want to track:

```sh
node bin/forge.js backlog init --folder docs/backlog
node bin/forge.js read "docs/backlog/Product Backlog.base"
```

Edit the `product-backlog` view's options with `patch` (one option per call) or replace the file with `write --stdin --if-match <revision>`. A typical view binds states, stamps, dates, dependencies, iterations and releases:

```yaml
  - type: product-backlog
    name: Backlog
    homeFolder: "docs/backlog"
    stateProperty: note.status
    stateValues: Open, Active, Done
    startedStates: Active
    startedDateProperty: note.started
    finishedDateProperty: note.finished
    startProperty: note.start
    targetProperty: note.due
    dependsOnProperty: note.dependsOn
    iterationProperty: note.iteration
    iterationGoalProperty: note.goal
    releaseProperty: note.release
    wipLimit.active: "2"
```

Add a `product-release` view to manage releases: at least `membershipProperty: note.release`, `targetDateProperty: note.target-date`, `releaseStatusProperty`, `releasedDateProperty`, `releasedStatusValues`, `releasedTransitionValue`, `releaseNotesFolder` and, when the backlog is not under `docs`, `releaseFolder`. Run `backlog check`: `writable: true` and no `config` problems mean the configuration is consistent. With several backlogs in one project, pass `--base` and `--view`, or set `plugins.settings.backlog.base` in `bin/config.json`.

## Decompose work

Add items top down; each lands in its type folder with the next `pbl-id` at the end of its siblings:

```sh
node bin/forge.js backlog add Epic "Trip planning"
node bin/forge.js backlog add Feature "Route sharing" --parent "Trip planning"
node bin/forge.js backlog add PBI "Share a link" --parent "Route sharing" --state Open
node bin/forge.js backlog add Task "Write the share dialog" --parent "Share a link" --dry-run
```

Review `data.changes[0].diff` of a dry run before writing. Name items by title, path or `#<pbl-id>`; `BACKLOG_AMBIGUOUS` lists candidates when a title repeats. Use `backlog tree` to review the hierarchy and `backlog list` for the global rank.

## Rank and track

Reorder within or across parents; only the moved note's `parent` and `order` change:

```sh
node bin/forge.js backlog move "Export GPX" --before "Share a link"
node bin/forge.js backlog move "Share a link" --parent "Trip planning" --first
node bin/forge.js backlog set "Share a link" --state Active
node bin/forge.js backlog depend "Share a link" --on "Export GPX"
node bin/forge.js backlog board
```

`BACKLOG_NO_GAP` means the neighbours share a rank or no gap is left: run `backlog ranks respace` (or `backlog ranks seed` for unranked items) and move again. `set` stamps the started and finished dates the view binds; `--today 2026-10-01` makes the stamp reproducible. `board` reports `over` for columns above their WIP limit.

## Plan an iteration

```sh
node bin/forge.js backlog iteration add --goal "Share a route"
node bin/forge.js backlog iteration assign "Share a link" "1 - Iteration - Share a route"
```

The iteration starts the day after the latest iteration ends (or today) and lasts `iterationLengthDays`; assigning an item copies the iteration's dates onto it.

## Ship a release

```sh
node bin/forge.js backlog release add 1.0 --release-version 1.0.0 --target-date 2026-12-01
node bin/forge.js backlog release join "Share a link" 1.0
node bin/forge.js backlog release readiness 1.0
node bin/forge.js backlog release notes 1.0
node bin/forge.js backlog release mark-released 1.0
```

Joining fills the item's empty start and target dates only. Readiness reports `estimated`, `blocked` and `risk` criteria with the outstanding items; fix them, then regenerate the notes, which replace only a file this release generated before. Finish with `backlog check` and `links unresolved` to confirm the graph is clean.
