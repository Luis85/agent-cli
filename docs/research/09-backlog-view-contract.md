# backlog-view compatibility contract

[Research index](README.md) · Researched 2026-10-10

The Forge must manage a backlog that is fully compatible with [Luis85/backlog-view](https://github.com/Luis85/backlog-view). Two properties are required:
- Files written by Forge must open and behave correctly in the plugin.
- Files written by the plugin must round-trip through Forge losslessly.

This page extracts the on-disk contract from the plugin source at commit `fb813df`. That commit is plugin id `product-backlog-view`, version `0.10.0` with `minAppVersion 1.12.0`, plus the unreleased changes already on `main`. Source references point into the plugin's `src/` folder. *Inferred* marks a conclusion drawn from the code rather than a stated rule. *Unclear* marks something the repository does not settle.

## Versioning

- The data has no schema-version marker in frontmatter or `.base` files, and the plugin runs no data migrations. Its ADR 0016 allows breaking changes before 1.0; old option values simply stop being read.
- Two unreleased changes affect data:
  - `order` is now one global rank across everything the base returns, not a rank among siblings.
  - Joining a release now writes dates onto the item.
- Forge should pin the plugin version it conforms to and add fixtures whenever the plugin changes its contract.

## Vocabulary

Type names are matched case-insensitively and written in canonical spelling (`domain/typeVocabulary.ts`).

| Group | Types | Rules |
| --- | --- | --- |
| Ladder | Epic → Feature → PBI → Task | A child sits one rung below its parent; the deepest rung is clamped |
| Test ladder | Test suite → Test case → Task | Shown in the catalog projection |
| Extra | Issue, Bug, Idea, Deliverable, Improvement | May hang under any rung above Task, or be a root. Their children are Tasks. They rank with PBI |
| Markers | Milestone, Iteration, Release | Offered no children. A milestone is a date, an iteration a time box, a release a set of work |
| Reserved | Resource, Absence | Never treated as backlog items |

Type rules guide the UI; they refuse nothing (ADR 0009). Unknown types are kept and take the next rung below their parent. With `hierarchyOnly` on (the default), a root subtree with no parent links, folder parents or known types is pruned (`model.ts:645`).

**States** are free text. Done values are matched case-insensitively and default to `Done, Closed, Completed, Removed`. Deliverables and the test ladder may have their own state property and values; each falls back to the main one when unset.

**Board columns** follow the configured `stateValues`. Without that list, they are the observed values plus a done value. The "no state" column deletes the key.

**Iterations** and **Releases** are notes, and an item joins one through a link property. A **Horizon** places an item on a Now/Next/Later axis. **Dependencies** are a `dependsOn` link list.

## Files

| Kind | Location and name |
| --- | --- |
| Item, marker or test note | The `typeFolder.<type>` option, else `homeFolder` (default `docs`). Default subfolders: epic/feature/pbi → `requirements`, task → `tasks`, issue → `issues`, bug → `bugs`, idea → `ideas`, deliverable → `deliverables`, improvement → `improvements`, milestone → `milestones`, iteration → `iterations`, test suite → `tests/suites`, test case → `tests/cases`. In folder mode a child is filed beside its parent's folder note |
| Release note | `releaseFolder`, default `docs/releases` |
| Resource note | `resourceFolder`, default `<home>/resources` |
| Absence note | `typeFolder.absence` or home. Title: `<resource> away <start> → <target>` |
| `.base` | `<folder>/Product Backlog.base`, then ` 1`, ` 2`… on collision |
| Generated readme | `<homeFolder>/README_PRODUCT_BACKLOG.md` |
| Release notes | `<releaseNotesFolder>/<release basename> release notes.md` |

- The plugin has no `data.json` and no settings tab. All view working state lives in browser `localStorage` (schema `v: 1`) and is out of scope for Forge.
- **File names:**
  - `sanitizeTitle` replaces `\ / : * ? " < > | # ^ [ ]` with `-`, collapses whitespace, and trims leading `-`, space and `.` and trailing `-` and space. It falls back to `Untitled`. Collisions append ` 1`, ` 2`…
  - The basename is the title; no title property is written.
- **New notes** contain only frontmatter: `---\n<yaml>---\n`.
- **Ids:** `pbl-id` is a fixed key. Its value is the integer max over every numeric `pbl-id` in the vault, plus one. It is written only at creation and is best-effort unique.
- **Iterations:** the default name is `<N> - Iteration`, where N is the highest leading number plus one, optionally followed by ` - <goal ≤ 60 chars>`. The default start is the day after the latest iteration's target, or today. The default length is `iterationLengthDays` (14).

## Frontmatter schema

Property names come from each view's options in the `.base`. An unbound optional property disables its feature, and the plugin never writes that key.

| Role | View option | Suggested key | Written as | Read tolerance |
| --- | --- | --- | --- | --- |
| parent | `parentProperty` | `parent` | `"[[linktext]]"`. In folder mode a root is `''`; otherwise a root has no key | Frontmatter link, bare name, alias or heading link. A list uses its first entry |
| order | `orderProperty` | `order` | number | number or numeric string |
| type | `typeProperty` | `type` | canonical string | case-insensitive. A list uses its first entry |
| id | none | `pbl-id` | integer, at creation only | none |
| tags | `tagsProperty` | `tags` | YAML list; the key is removed when empty | list or comma/space string, `#` stripped |
| state | `stateProperty` | `status` | string; "no state" deletes the key | string |
| deliverable/test state | `deliverableStateProperty`, `testStateProperty` | `status` | string | string |
| started/finished | `startedDateProperty`, `finishedDateProperty` | `started`, `finished` | `YYYY-MM-DD`, local time | none |
| horizon | `horizonProperty` | `horizon` | string; deleted when unplaced | string |
| planned dates | `startProperty`, `targetProperty` | `start`, `due` | `YYYY-MM-DD`; an existing time suffix is kept | `^\d{4}-\d{1,2}-\d{1,2}([Tt\s].*)?$` with month and day validated |
| dependsOn | `dependsOnProperty` | `dependsOn` | always a YAML list of `"[[linktext]]"`; deleted when empty | list or scalar; invalid entries kept |
| risk, priority | `riskProperty`, `priorityProperty` | `risk`, `priority` | string. Defaults `1 - High, 2 - Normal, 3 - Low` and `1 - Must, 2 - Should, 3 - Could, 4 - Won't` | string |
| assignee | `assigneeProperty` | `assignee` | one link to a `type: Resource` note | first link, or a bare name |
| iteration | `iterationProperty` | `iteration` | one link to an Iteration | first link |
| goal | `iterationGoalProperty` | `goal` | string, Iteration notes only | none |
| release | `releaseProperty`, `membershipProperty` | `release` | exactly one link to a Release | `''`, a list of two or more, a non-string, or a non-Release target leaves the membership unresolved |
| release view keys | `versionProperty`, `targetDateProperty`, `releaseStatusProperty`, `releasedDateProperty`, `descriptionProperty`, `estimateProperty`, `capacityProperty` | `version`, `target-date`, `status`, `released`, `description`, `effort`, `capacity` | strings, `YYYY-MM-DD`, non-negative numbers | release dates must be a single valid date |
| estimation | `dimProperty.<id>`, `confidenceProperty`, `effortProperty`, `complexityProperty`, `valueProperty`, `stampProperty` | dimension ids, `confidence`, `effort`, `complexity`, `business-value`, `business-value-model` | numbers. The total is rounded to 2 decimals. The stamp is `"<answered>/<enabled> <8-hex FNV-1a>"` | none |

- **Key order on create:** `pbl-id`, type, parent, order, goal, iteration, release, then axis keys.
- **Link text:** written as `'[[' + fileToLinktext(target, source) + ']]'`, always a wikilink whatever the vault's link format setting. This yields the basename when unique, otherwise the path without `.md`; that is Obsidian behavior, *unclear* here.
- **YAML style:** the plugin uses Obsidian's `stringifyYaml` through `processFrontMatter`.
  - Unknown keys survive (*inferred*), but comments and the original quoting are lost.
  - Observed output double-quotes wikilinks, writes empty stubs as `""` and uses block lists.
  - The exact formatting is not pinned by the plugin's tests. Forge must produce equivalent YAML and be tolerant when reading.

## The `.base` file

The plugin registers four view types: `product-backlog`, `product-estimation`, `product-release` and `product-my-work`. The "Create backlog" command scaffolds this file:

```yaml
filters:
  and:
    - "file.inFolder(\"docs\")"
    - file.ext == "md"
views:
  - type: product-backlog
    name: Backlog
    homeFolder: "docs"
```

**Option encoding:**
- Property options are Bases property ids of the form `note.<key>`.
- Lists are comma-separated strings, trimmed and mostly de-duplicated case-insensitively.
- Booleans are YAML booleans.
- "Clearable" options (`homeFolder`, `typeFolder.*`, `resourceFolder`, `horizonValues`, `riskValues`, `priorityValues`, `tagsProperty`, `releaseDateProperty`, `releaseFolder`) mean the default when absent and off when present but empty.

**Backlog view options:**
- `*Property` mappings
- `hierarchyOnly` (default true), `showOutsideParents` (true), `inferFolderHierarchy` (false), `showCounts` (true), `openIn`
- `stateValues`, `doneValues`, `startedStates`
- `wipLimit.<state>` (integer ≥ 1), `columnPolicy.<state>`
- `stateColor.<state>`: one of red, orange, yellow, green, cyan, blue, purple, pink
- deliverable and test state value lists
- `iterationOpenStates`, `iterationResolvedStates`, `iterationLengthDays`, `iterationsOnTimeline`, `iterationBars`
- `horizonValues`, `riskValues`, `priorityValues`
- `homeFolder`, `typeFolder.<type>`, `resourceFolder`, `tagsProperty`, `releaseDateProperty`

**Release view options:**
- `membershipProperty`
- state and done mappings
- `releaseStatusValues`, `releasedStatusValues`, `releasedTransitionValue`
- `releaseNotesFolder`, `releaseFolder`
- `capacityUnit`, `dependsOnProperty`, `riskProperty`, `criticalRiskValues`, `addressedRiskValues`

**Estimation view options:**
- `dimensions`, `outputRange`
- the per-dimension property, weight, range, direction, label and rubric options
- indicator options
- value, stamp and type properties

**Filters:** the Bases filter defines the results. Ancestors outside the filter load as read-only context rows and are never written.

The plugin's own `docs/Product Backlog.base` contains all four view types and is the natural conformance fixture.

## Write semantics and refusals

- **Frontmatter edits** are read-modify-write through `processFrontMatter`. Each key is written with `defineProperty`, so `__proto__` is safe. Removing a value deletes the key; it never blanks it.
- **Creation** is one `vault.create` containing all frontmatter. Batches are serialized but not transactional.
- **Refused writes:**
  - Any write to a `Resource` note.
  - A field the live type may not hold (`mayHoldField`):
    - `release` is refused on markers and on test-ladder items.
    - A Release may not hold horizon, dates, iteration or goal.
    - Milestones, and Iterations without bars, hold only a target date.
  - A release link to a non-Release note, or an assignee link to a non-Resource note.
  - A reversed date span.
  - A batch touching a note outside the base filter.
  - Every write while two roles share one key (the workflow-state roles may share).
- **Moves** write one note's `parent` and `order`. They never change the type.
- **Ranks:**
  - `ORDER_SPACING = 1000`. A midpoint is rounded to 6 decimals; an edge position is `floor(neighbor) ± 1000`.
  - If there is no gap, or the neighbors tie, the move is refused. On a tie it falls back to sibling-scoped arithmetic.
  - New items go to the end of their sibling group.
  - "Seed ranks" numbers every note 1000, 2000… in tree preorder. "Respace ranks" does the same in current rank order. Both leave context rows unchanged.
- **State writes:**
  - `started` is stamped when entering a started state, if the state actually changes and the field is empty.
  - `finished` is stamped on crossing into done and deleted on crossing out. Done to done writes nothing.
- **Iteration join** writes the link and overwrites start and target with the iteration's dates.
- **Release join** writes the link. It fills start (today) and target (the release's `target-date`) only when both are empty and the span stays valid.
- **Backfill** writes a missing `order` and an implied type, except on orphans. It also adds `''` stubs for configured optional keys, but never for `dependsOn`, `goal` or `release`.
- **Renames:** the plugin relies on Obsidian to rewrite links. Forge must rewrite every inbound frontmatter wikilink itself when it renames a note.

## Releases

- **Status** is free text. A release counts as shipped when its released date holds a valid date. Overdue means not shipped and the target is before today.
- **Mark as released** writes `status = releasedTransitionValue` and `released = today` to the release note only. The plugin first checks the expected current values and that the note is still `type: Release`.
- **Config problems:**
  - The released-date key equals the target-date key.
  - The transition value is not one of the released values.
  - The membership key collides with another role.
- **Readiness** covers direct members only and writes nothing. It reports each criterion as satisfied, partly, not, unconfigured or empty:
  - estimated: the estimate is a non-negative number;
  - blocked: a prerequisite is broken or not done;
  - risk: a critical risk value is present without an addressed value.
- **Release notes:**
  - Line 1 is the marker `<!-- Generated by the Product Backlog view from "<base path> › <view name> › <release path>". Rewritten in full whenever it is regenerated. -->`, with the source percent-encoded.
  - Then come `# <release>`, two fixed sentences, `## <Type>` groups in vocabulary order with `- <title>` bullets, and `## Other` for untyped members.
  - The content is undated and deterministic. An existing file is replaced only if its marker names the same source.

## Invariants

- **Parents:** a note has one parent, its first link. An unresolved parent makes the note an orphan root. A cycle is cut at the node that closes the loop.
- **Dependencies:** entries that are self-referencing, cyclic (found with Tarjan's algorithm) or unresolved are marked broken but kept on disk.
- **Ranks:** uniqueness is not enforced. Ties follow the Bases result order, and unranked items sort last.
- **Unreadable values:** an unreadable date or horizon shelves the item with a reason.
- **Context rows:** never written to and never counted as results.

## Gaps and ambiguities

- The plugin README lists column width and show-completed as `.base` options. The code stores both in `localStorage`, so the README is out of date there.
- Obsidian's exact `processFrontMatter` YAML output is not pinned by tests. Forge needs fixtures taken from real plugin-written files.
- Link rewriting on rename may depend on the user's Obsidian "auto-update links" setting.
- Sample notes in the plugin repository contain older stub output that current code would not write.
- The plugin repository's `.claude` skills describe that repository's own conventions (`created`, `closed`, `area`), not plugin rules.
