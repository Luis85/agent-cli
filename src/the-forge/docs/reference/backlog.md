# Backlog

[Documentation](../index.md) · Reference

`backlog` manages a product backlog that the Obsidian [Product Backlog view](https://github.com/Luis85/backlog-view) (backlog-view) opens unchanged: Epics, Features, PBIs and Tasks in a hierarchy, one global rank, workflow states, iterations, releases and dependencies, all as frontmatter of ordinary Markdown notes. It is contributed by the `backlog` [core plugin](plugins.md#bundled-core-plugins) (`src/plugins/backlog/` in the Forge source), enabled by default. It requires the `bases.query` service of the `bases` core plugin, so disabling `bases` makes `backlog` unavailable: `plugins` lists it as `unavailable` with the reason, and its commands fail with `PLUGIN_UNAVAILABLE`.

Forge conforms to backlog-view 0.10.0 (plugin id `product-backlog-view`) with the global rank and release-join dates of commit `fb813df` on its `main` branch. The [conformance](#conformance) section lists what the fixtures prove and where Forge differs.

```sh
node bin/forge.js backlog init --folder docs/backlog
node bin/forge.js backlog add Epic "Trip planning"
node bin/forge.js backlog add Feature "Route sharing" --parent "Trip planning"
node bin/forge.js backlog move "Route sharing" --first
node bin/forge.js backlog set "Route sharing" --state Active
node bin/forge.js backlog tree
node bin/forge.js backlog check
```

## The base is the configuration

A backlog is one `product-backlog` view of a `.base` file. The base's filters (global and view filters) select the notes; the view's options bind roles to frontmatter keys and declare vocabularies. Forge evaluates the filter with the [Bases engine](bases.md) and reads every option the way backlog-view's `settingsResolve.ts` does:

- Property options hold Bases property ids such as `note.status`; a bare name is a note property. An unbound optional property turns its feature off, and Forge then never writes that key (`BACKLOG_WRITE_REFUSED` with `reason: "unbound-property"`).
- Lists are comma-separated strings, trimmed, empty entries dropped and (for vocabularies) de-duplicated case-insensitively.
- Booleans are YAML booleans; anything else means the default.
- Clearable options (`homeFolder`, `typeFolder.<type>`, `resourceFolder`, `horizonValues`, `riskValues`, `priorityValues`, `tagsProperty`, `releaseDateProperty`, `releaseFolder`) mean the default while absent and "off" while present but empty.

| Option | Default | Used for |
| --- | --- | --- |
| `parentProperty`, `orderProperty`, `typeProperty` | `parent`, `order`, `type` | Hierarchy, rank and type |
| `stateProperty`, `stateValues`, `doneValues` | unbound, observed states, `Done, Closed, Completed, Removed` | States and board columns |
| `startedStates`, `startedDateProperty`, `finishedDateProperty` | none | Start and finish stamps |
| `wipLimit.<state>`, `columnPolicy.<state>` | none | Board limits (integers of at least 1, never on done states) and policies |
| `deliverableStateProperty`, `deliverableStateValues`, `deliverableDoneValues`, and the `test…` equivalents | the requirements workflow | Own workflows of Deliverables and test-ladder items |
| `startProperty`, `targetProperty`, `horizonProperty`, `horizonValues` | unbound, `Now, Next, Later` | Planned dates and the roadmap horizon |
| `riskProperty`, `riskValues`, `priorityProperty`, `priorityValues` | unbound, `1 - High, 2 - Normal, 3 - Low`, `1 - Must, 2 - Should, 3 - Could, 4 - Won't` | Labels; a value matching a declared one is written in its declared spelling |
| `assigneeProperty` | unbound | One link to a `type: Resource` note |
| `dependsOnProperty` | unbound | Prerequisite link lists |
| `iterationProperty`, `iterationGoalProperty`, `iterationLengthDays` | unbound, unbound, 14 | Iterations |
| `releaseProperty`, `releaseDateProperty` | unbound, `target-date` | Release membership and a release's target date |
| `homeFolder`, `typeFolder.<type>`, `resourceFolder` | `docs`, `<home>/<subfolder>`, `<home>/resources` | Where new notes go |
| `hierarchyOnly`, `showOutsideParents`, `inferFolderHierarchy` | `true`, `true`, `false` | Pruning, context ancestors and folder mode |

Releases are managed by the base's first `product-release` view, with its own options: `membershipProperty`, `versionProperty`, `targetDateProperty`, `releaseStatusProperty`, `releasedDateProperty`, `descriptionProperty`, `estimateProperty`, `capacityProperty`, `dependsOnProperty`, `riskProperty`, `criticalRiskValues`, `addressedRiskValues`, `releasedStatusValues`, `releasedTransitionValue`, `releaseNotesFolder` and `releaseFolder` (default `docs/releases`). Estimation, My Work and absence views are read as part of the base but not edited.

### Choosing the backlog

Every action except `init` opens one backlog: `--base <file.base> [--view <name>]`; otherwise `plugins.settings.backlog.base` and `.view` in `bin/config.json`; otherwise the only `product-backlog` view among the scope's `.base` files. No view fails with `BACKLOG_NOT_FOUND`; several fail with `BACKLOG_AMBIGUOUS` and `details.candidates` (`{base, view}` pairs).

```json
{ "plugins": { "settings": { "backlog": { "base": "docs/Product Backlog.base", "view": "Backlog" } } } }
```

## The model

- **Results and context rows.** The view's results are the items, in Bases result order. With `showOutsideParents`, ancestors the filter leaves out are loaded as read-only context rows (`context: true`): they place results in the tree but are never written or counted.
- **Hierarchy.** A note's parent is the first frontmatter link of the parent key (a list uses its first entry); a bare name or `[[Note#Heading|Alias]]` resolves like Obsidian's `getFirstLinkpathDest`: a name several notes share opens the closest one (see [Bases file context](bases.md#file-context)). An unresolved parent makes the note an orphan root (`orphan: true`). A parent loop is cut at the note that closes it (`backlog check` reports `parent-cycle`). In folder mode, a note without a parent value hangs under the nearest folder note (`a/b/b.md`); `parent: ""` is an explicit root. With `hierarchyOnly`, a root subtree with no parent links, folder parents or known types is pruned (`ignored`).
- **Types.** Matched case-insensitively and written canonically. The ladder is Epic → Feature → PBI → Task, the test ladder Test suite → Test case → Task; a child takes the rung below its parent and the deepest rung is clamped. Issue, Bug, Idea, Deliverable and Improvement rank with PBI. Milestone, Iteration and Release are markers. Untyped notes take the implied rung (`impliedType: true`); unknown types are kept. `Resource` and `Absence` notes are never items.
- **Ranks.** `order` is one global rank across everything the base returns. Items sort by rank, ties by result order, unranked last; siblings use the same order. `rank` in the output is the 1-based global position.
- **States.** `done` matches the done values case-insensitively. Deliverables and test-ladder items use their own workflow keys and values, falling back to the requirements workflow.
- **Dependencies.** Entries of the dependsOn list that are unresolved, self-referencing or on a loop (Tarjan's strongly connected components) are broken (`brokenDependencies` with `reason` `unresolved` or `cycle`) but stay on disk. Markers and context rows declare none.
- **Releases.** An item belongs to a release when its membership key holds exactly one link to a `type: Release` note of the release view. A missing key or an empty list names none; `''` (such as `release: ""`), a list of two or more, a non-string, a non-Release target, a marker or a test-ladder item is an unresolved membership.

## Commands

All actions take `--base`, `--view` and `--today YYYY-MM-DD` (the date used for stamps and defaults; default: today in local time). Items are named by vault path (with or without `.md`), link text, title (case-insensitive) or `pbl-id` (`#12`); a title shared by several items fails with `BACKLOG_AMBIGUOUS`.

| Action | Result |
| --- | --- |
| `init [--folder docs]` | Writes the plugin's "Create backlog" scaffold to `<folder>/Product Backlog.base` (then ` 1`, ` 2`… when taken): `file.inFolder("<folder>")`, Markdown only, one `product-backlog` view named Backlog with `homeFolder`. Returns `{path, folder, view, changes}` |
| `list [--context]` | `{base, view, total, items, ignored}`: items by global rank; `--context` adds context rows |
| `tree` | `{base, view, roots, ignored}`: the hierarchy in sibling rank order, each node with `items` |
| `board` | `{base, view, stateProperty, columns}`: the no-state column first, then `stateValues` (or observed states plus a done value), then observed states outside the workflow (`outsideWorkflow`). Each column has `state`, `done`, `limit`, `over` (items above the WIP limit), `policy`, `count` and `cards`. Deliverables are not on this board |
| `show <item>` | `{item, ancestors, childItems, dependents}` |
| `add <type> <title> [--parent] [--folder] [--state] [--iteration] [--release] [--assignee] [--tags a,b]` | A new note exactly as `createBacklogItem` writes it (see [new notes](#new-notes)); `item` names its `path`, `id` and `order` |
| `move <item> [--parent <item> or --top] [--before <item>, --after <item>, --first or --last]` | Reparents and/or reorders; writes only the note's parent and order. See [ranks](#ranks) |
| `ranks seed` / `ranks respace` | Renumbers every result 1000, 2000… in tree preorder (`seed`) or current rank order (`respace`), around the ranks of context rows, which stay fixed |
| `set <item> [--state] [--horizon] [--priority] [--risk] [--start] [--due] [--assignee] [--type]` | One write with the given fields; an empty value (`--horizon ""`) deletes the key. See [state writes](#state-writes) |
| `depend <item> --on <item>` / `undepend <item> --on <item>` | Appends `"[[link]]"` to the dependsOn list, or removes entries naming that note (by resolved path, else raw text); the key is deleted when the list empties |
| `iteration add [--name] [--goal] [--start] [--due] [--length days]` | A new Iteration: `<N> - Iteration[ - <goal>]` with N the highest leading number plus one and the goal cut to 60 characters, starting the day after the latest iteration's target (or today) and `iterationLengthDays` long |
| `iteration assign <item> <iteration>` | Links the iteration and overwrites the item's start and target with the iteration's dates |
| `release add <title> [--release-version] [--target-date] [--status] [--description]` | A Release note as `createRelease` writes it, in the release view's `releaseFolder` |
| `release join <item> <release>` | Links the release (backlog view's `releaseProperty`); fills start (today) and target (the release's `target-date`) only while each is empty and the span stays valid |
| `release list` | The release index of the release view: per release `version`, `target`, `status`, `released`, `members`, `done`, `shipped`, `overdue`, `daysToTarget`, `slip`; plus `unresolved` memberships |
| `release readiness <release>` | Direct members' readiness, writing nothing: `criteria` `estimated`, `blocked` and `risk`, each `satisfied`, `partly`, `not`, `unconfigured` or `empty` with `outstandingPaths`; `estimatedEffort`, `completedEffort`, `unestimated` and the `scope` tree |
| `release notes <release>` | Writes `<releaseNotesFolder>/<release> release notes.md` (see [release notes](#release-notes)); `outcome` is `created`, `updated` or `unchanged` |
| `release mark-released <release>` | Writes `releaseStatusProperty = releasedTransitionValue` and `releasedDateProperty = today` on the release note only; `backlog.released` follows |
| `check` | `{ok, counts, writable, problems}`. See [check](#check) |

Mutating actions accept `--dry-run` (planned changes with unified diffs, nothing written, no `backlog.*` events) and, where one note is edited, `--if-match <revision>` for that note. Committed writes publish `vault.*` records and these events:

| Event | Payload |
| --- | --- |
| `backlog.item-created` | `{path, title, type, id, parent?, order?}` for `add`, `iteration add` and `release add` |
| `backlog.item-moved` | `{path, parent, order, previousParent, previousOrder}` |
| `backlog.state-changed` | `{path, title, from, to, started?, finished?}`: `from` and `to` are values of the item's own workflow (requirements, deliverable or test); `started` and `finished` belong to the requirements workflow (`finished: null` when leaving done) |
| `backlog.released` | `{path, name, status, released}` |

## New notes

A new note is one file holding only frontmatter, `---\n<yaml>---\n`, with keys in backlog-view's order: `pbl-id`, type, parent (`""` for a root in folder mode, otherwise absent), order, goal, iteration, release, then horizon, start and target. Forge appends the optional `--state` (in its [workflow's spelling](#state-writes), with its stamps), `--assignee` and `--tags` after them, in the order a later edit would add them. `--tags` is read like a frontmatter tags string, split on commas and whitespace with a leading `#` optional, and each tag is normalized as the plugin's tag editor writes it: characters Obsidian does not allow are trimmed at the edges and become `-` inside (`needs-review!` gives `needs-review`, `a!b` gives `a-b`), tags without a non-digit character such as `2026` are dropped, and duplicates are removed case-insensitively.

- **Name.** The title passes `sanitizeTitle`: `\ / : * ? " < > | # ^ [ ]` become `-`, whitespace collapses, leading `-`, space and `.` and trailing `-` and space are trimmed, and an empty result is `Untitled`. A taken name gets ` 1`, ` 2`… (compared case-insensitively). The basename is the title; no title property is written.
- **Folder.** In folder mode, beside the parent; otherwise `typeFolder.<type>`, else `homeFolder`, else the folder most results live in. `--folder` overrides.
- **Id.** `pbl-id` is the highest numeric `pbl-id` in the scope plus one.
- **Rank.** The end of the new sibling group under the global rank.
- **Links.** `"[[<fileToLinktext>]]"`: the basename when it resolves uniquely, otherwise the path without `.md`.
- **YAML.** Obsidian's `stringifyYaml` style: block mappings and lists, plain scalars where YAML allows, double quotes otherwise (`"[[Note]]"`, `""`, `"12"`).

Releases get `pbl-id`, type and the stated version, target date, status and description, and never an order or planning link. Iterations get the goal and their start and target.

## Ranks

`move` places the note between the neighbours its position implies in the global rank: the midpoint rounded to 6 decimals, or `floor(neighbour) ± 1000` at an edge, 1000 in an empty backlog. On a global tie it falls back to sibling-scoped arithmetic when that rank is free. Otherwise it refuses with `BACKLOG_NO_GAP` and `details.reason`: `tied`, `gapSpent`, `unranked` (a neighbour has no rank). Run `ranks respace` (or `ranks seed`) and move again. A move that keeps the parent and lands the note where it already is among its siblings (such as `--last` on the last sibling) writes nothing: `changes` is empty and no event follows, unless it clears a parent link that resolves to nothing. A move under the note itself or a descendant is refused (`parent-cycle`), and so is a move between the plan and the test catalog (`projection`). Ranks need not be unique; `check` reports ties.

## State writes

A state write uses the item's own workflow: Deliverables use the deliverable workflow, test-ladder items the test workflow, everything else the requirements workflow. A typed state that matches one of the workflow's declared values (its state values and done values) case-insensitively is written in the declared spelling (`--state "in progress"` writes `In Progress`), as a board column writes it; other values are written as typed. `--horizon`, `--priority` and `--risk` match `horizonValues`, `priorityValues` and `riskValues` the same way. Setting the state the item already holds, in any case, writes nothing. In the requirements workflow, `startedDateProperty` is stamped with `--today` when the state actually changes into a `startedStates` value and the key is empty; `finishedDateProperty` is stamped when crossing into a done value and deleted when crossing out; done to done writes nothing. Dates are `YYYY-MM-DD`; an existing time suffix on a planned date is kept, and an equal date is left alone.

## Refusals and the write gate

Every write first re-reads the note and refuses the whole batch, writing nothing, with `BACKLOG_WRITE_REFUSED` and `details.reason`:

| Reason | When |
| --- | --- |
| `outside-filter` | The note is a context row or not in the backlog |
| `resource` | The note is a `type: Resource` note |
| `field-not-held` | The type may not hold the field: a release link on markers and test-ladder items; horizon, dates, iteration or goal on a Release; a start on a Milestone (or an Iteration without bars, through `set`) |
| `not-a-release`, `not-a-resource`, `not-an-iteration` | A release, assignee or iteration link to a note of another type |
| `reversed-span` | The start would fall after the target |
| `parent-cycle`, `projection` | See [ranks](#ranks) |
| `marker`, `dependency-cycle` | A marker as a dependent or parent of a new item; a dependency that closes a loop |
| `reserved-type`, `use-release-add` | `Resource`/`Absence` items; Releases through `add` |
| `unbound-property` | The feature's property is not bound in the view |
| `already-released`, `unreadable` | `mark-released` on a released release or an unreadable status or date |
| `foreign-release-notes` | The release notes file was not generated from this base, view and release |

While two roles share one key (the three workflow-state roles may share), every write fails with `BACKLOG_CONFIG_PROBLEM` and `details.problems`. Unknown keys and every untouched frontmatter entry keep their bytes, including comments and folding; changed entries are rewritten in Obsidian's style, so a `""` stub becomes `priority: P1`.

## Release notes

The file starts with the marker `<!-- Generated by the Product Backlog view from "<source>". Rewritten in full whenever it is regenerated. -->`, where the source is `<base path> › <release view name> › <release path>` with `%` and `›` escaped in each part and then `%`, `<`, `>`, CR, LF and `-` before `-` percent-encoded. Then `# <release>`, two fixed sentences, `## <Type>` groups in vocabulary order with `- <title>` bullets in scope-tree order, and `## Other` for unknown types; an empty release says "This release contained nothing.". The content is undated and deterministic. An existing file is replaced only when its marker names the same source; otherwise the action is refused. Notes require `releaseNotesFolder` and `membershipProperty`.

## Check

`check` reads the backlog and reports `problems`, each `{code, severity, message, path?, key?, value?, paths?}`. `ok` is false when any is an error.

| Code | Severity | Meaning |
| --- | --- | --- |
| `config`, `release-config` | error | Roles sharing a key; release properties sharing a key, released date = target date, a transition value that is not a released value, a membership key colliding with another role |
| `parent-cycle`, `unresolved-parent` | error | A cut parent loop; a parent that does not resolve to a loaded note |
| `dependency-cycle`, `unresolved-dependency` | error | Broken dependsOn entries |
| `broken-iteration` | error | An iteration link to a missing or non-Iteration note |
| `unresolved-membership` | error | A release membership that does not resolve to exactly one Release |
| `field-not-held` | error | A field the type may not hold |
| `broken-assignee` | warning | An assignee that is not a Resource note |
| `unreadable-date`, `unreadable-horizon`, `reversed-span` | warning | Values the plugin shelves |
| `rank-tie`, `unranked` | warning | Results sharing a rank; results other than releases without one (releases are created unranked) |
| `unparseable-note`, `ambiguous-link` | warning | The Bases index [warnings](bases.md#compatibility-and-errors) about results and context rows: a note read without properties because it cannot be parsed, and a link (`value`) several notes match that resolves to the closest |

One unparseable note or ambiguous link never fails a backlog command, wherever it is in the scope.

## Conformance

Fixtures copied from backlog-view `fb813df` (its `docs/Product Backlog.base` and plugin-written notes) live in `tests/backlog/fixtures`, with expected outputs derived from the plugin's code:

| Behaviour | Evidence |
| --- | --- |
| Settings resolution of the plugin's own base, defaults, clearable options, lists, limits, colours, release settings and configuration problems | `tests/backlog/settings.unit.test.ts` |
| Reading plugin-written notes: hierarchy, orphans, global rank with result-order ties, types and ladders, states, board columns, releases and readiness | `tests/backlog/conformance.integration.test.ts`, `model.unit.test.ts`, `releases.unit.test.ts` |
| Round trip: a write to any fixture note changes only the written line | `conformance.integration.test.ts` |
| Created notes, a release and the base scaffold byte-equal to `createBacklogItem`, `createRelease` and "Create backlog" | `fixtures/expected/*`, `notes.unit.test.ts` |
| Rank arithmetic, seed and respace | `ranks.unit.test.ts`, `commands.integration.test.ts` |
| Stamps, refusals, fill-only release dates, dependsOn lists, time suffixes | `writes.unit.test.ts` |
| Release notes text and marker | `releases.unit.test.ts`, `fixtures/expected/Eratic Skunk release notes.md` |
| The complete CLI workflow | `tests/backlog/cli.e2e.test.ts` |

Known differences and open questions:

- Obsidian rewrites the whole frontmatter on every `processFrontMatter`; Forge rewrites only changed entries. Both read the same. YAML style is taken from plugin-written notes; the plugin's tests do not pin Obsidian's exact `stringifyYaml` output, such as where it folds long strings.
- Links in notes resolve like Obsidian: a name several notes share opens the closest one, and a note whose frontmatter cannot be parsed is read without properties; `check` reports both as warnings. Item names given on the command line (`--parent`, `--on`, `--assignee`) must stay unambiguous.
- A bare property name in a view option is read as a note property; Obsidian's `getAsPropertyId` for such hand-edited values is unverified.
- Generated release notes use the plugin's English sentences; the plugin writes its own catalog's text.
- Batches are transactional in Forge, where the plugin applies writes one note at a time and stops at the first refusal.
- Absences, My Work and estimation are read only; renames rely on the kernel `move`, which rewrites frontmatter links.
