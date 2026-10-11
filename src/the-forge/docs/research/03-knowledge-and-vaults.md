# Knowledge vaults and agent memory

[Research index](README.md) · Researched 2026-10-10

## Summary

- Obsidian now ships an **official CLI** (desktop 1.12.4, February 2026). It covers search, backlinks, unresolved links, orphans, dead ends, link-aware `move`/`rename`, properties, tasks, daily notes and `base:query`. It **needs a running desktop app**, and a third-party guide reports exit codes of 0 on errors and no batching. A headless, guarded, JSON-native vault engine is still a real niche. The Obsidian CLI's command names have become the vocabulary that agents and users will expect.
- **Obsidian Headless** (open beta, `npm install -g obsidian-headless`, Node 22+) syncs and publishes vaults without the app and names "agentic tools" as a target use. It does not edit or query notes, so it complements Forge rather than competing with it.
- Bases is moving quickly: table and cards (1.9), list, map and a plugin API (1.10), kanban (1.14, September 2026), summaries, and `html()`/`image()`/`icon()` functions. JSON Canvas is still 1.0.
- The main agent-memory systems have converged on **Markdown plus frontmatter as the source of truth, with a rebuildable index on top**. Examples are the Claude memory tool, Claude Code auto memory, Letta context repositories, Basic Memory and Karpathy's "LLM Wiki". All of them need six primitives: view, create, replace, insert, **delete** and **rename**, plus search and a lint pass.
- Forge's strongest assets are revision guards, dry-run, stable exit codes, path containment, source-preserving edits and a standalone Bases evaluator with oracle evidence. Forge also already has a link/tag/backlink indexer inside `bases query`, but no command exposes it.
- The largest gaps (P0): no `delete`, no link-rewriting `move`/`rename`, no `search`, and no `links`/`backlinks`/`unresolved`/`orphans` commands. Without these, Forge cannot back even the Claude memory tool's own command set.
- Next priorities (P1): a vault lint that also checks heading and block anchors and property types; tag and property inventories with property removal; heading- and block-addressed edits; row and value output for `bases query`; bulk property migration; and daily notes.

## Method

I read the product brief, `docs/reference/formats.md`, `docs/reference/bases.md` and `bin/skills/forge-vault.md`. I also inspected `src/the-forge/infrastructure/bases/links.ts` to confirm how links are actually indexed, and ran `node bin/app.js schema --json` to list the command catalog. I searched the web and fetched primary sources wherever I could: Obsidian help pages and changelogs, the Claude platform and Claude Code docs, Letta docs and blog, GitHub READMEs, and Karpathy's gist. Claims that come only from search-result summaries or third-party write-ups are marked *(third-party)* or *(unverified)*. Star counts are as displayed on 2026-10-10.

## Findings

### Official Obsidian tooling

**Obsidian CLI.** It was released in desktop 1.12.4 ([changelog](https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/)). The [command reference](https://obsidian.md/help/cli) says it requires the 1.12.7+ installer and a running desktop app, and the first command launches the app if it is closed. Its command groups are:

- Files: `files`, `read`, `create`, `append`, `prepend`, `move`, `rename`, `delete` (to trash unless `permanent`)
- Links: `backlinks`, `links`, `unresolved`, `orphans`, `deadends`
- Notes and metadata: `outline` (tree/md/json), `aliases`, `properties`, `property:set`, `property:remove`, `property:read`, `tags`, `tasks`
- Search: `search` and `search:context` (`path:line: text`)
- Other: `daily:*`, templates, `bases`/`base:views`/`base:create`/`base:query` (json, csv, tsv, md, paths), file history and diff, Sync, Publish, plugins, and developer commands including `eval`

`move` and `rename` "automatically update internal links if the vault setting is enabled". `file=` resolves names the way a wikilink does, and `path=` takes an exact path. A detailed [third-party guide](https://www.dsebastien.net/the-complete-guide-to-the-obsidian-cli-everything-you-can-do-from-the-terminal/) reports several agent-relevant limits *(third-party)*:

- Errors are printed while the exit code stays 0.
- There is no batching, at roughly one second per call.
- Writes can report success without changing anything.
- Parallel `move`/`eval` calls can collide.
- List properties are awkward to set.

**Obsidian Headless.** It is an open-beta npm package with the binary `ob`, and it needs Node 22+ ([help](https://obsidian.md/help/headless)). It is "independent" of the desktop app. Its listed uses include automated backups, publishing, and "giving agentic tools vault access … without access to your full computer". [Headless Sync](https://obsidian.md/help/sync/headless) provides `ob sync`, `ob sync --continuous`, `pull-only`/`mirror-remote` modes and `--conflict-strategy merge|conflict`. It warns against running desktop Sync and Headless Sync on the same device. Headless is limited to sync and publish; it has no note query or edit commands.

**Bases.**

- View types: table and cards (1.9), list and map (1.10, map via the Maps plugin) and kanban (1.14) are listed on the [views page](https://obsidian.md/help/bases/views).
- 1.10 changes: [1.10.0](https://obsidian.md/changelog/2025-10-01-desktop-v1.10.0/) added the Bases API, group-by, table summaries, `reduce()`, `html()` and `random()`. [Plugin docs](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerBasesView) document `registerBasesView` *(seen in search results)*.
- 1.14 changes: [1.14.0](https://obsidian.md/changelog/2026-09-02-desktop-v1.14.0/) added kanban "using Group by to define the columns" and collapsible groups. It also fixed the "+" button so it writes correct frontmatter for unresolved links.
- Syntax: the [syntax page](https://obsidian.md/help/bases/syntax) documents top-level `summaries` that use `values` and 15 default summary functions. It defines `this` as the base itself, the embedding note, or the active file when shown in the sidebar. It calls `file.backlinks` "performance-heavy".
- Functions: the [function reference](https://obsidian.md/help/bases/functions) lists global functions including `image()` and `icon()`, and file methods `hasLink`, `hasTag`, `hasProperty`, `inFolder` and `asLink`.

**JSON Canvas.** [jsoncanvas.org](https://jsoncanvas.org/) lists only spec 1.0, and I found no 1.1. Forge's 1.0 validator is current.

**Properties.** According to the [help page](https://obsidian.md/help/properties):

- There are seven types: Text, List, Number, Checkbox, Date, Date & time and Tags.
- A type assigned to a name applies vault-wide.
- Wikilinks in Text and List properties must be quoted.
- Nested properties are unsupported in the Properties UI.
- The singular `tag`/`alias`/`cssclass` are no longer supported as defaults as of 1.9.

The help page does not name `.obsidian/types.json` as the storage file. Forge's reliance on it is therefore based on observed behaviour rather than documentation *(unverified in official docs)*.

**Link semantics.** The [links help](https://obsidian.md/help/links) states:

- Heading links take the form `[[Note#Heading#Sub]]`.
- Block IDs "can only consist of Latin letters, numbers, and dashes", and IDs for lists, quotes, callouts and tables go on their own line.
- Display text uses `|`.
- Links are updated on rename **by default**.

[Obsidian Flavored Markdown](https://obsidian.md/help/obsidian-flavored-markdown) combines CommonMark, GFM and LaTeX, and it adds wikilinks, embeds, block references, `%%comments%%`, highlights and callouts.

**kepano/obsidian-skills.** The [repo](https://github.com/kepano/obsidian-skills) has 49.3k stars and an MIT licence. It ships six skills: obsidian-markdown, obsidian-bases, json-canvas, obsidian-cli, defuddle and knap (rendering templates from JSON/CSV). It installs as a Claude Code plugin marketplace or via `npx skills`. Its [obsidian-cli skill](https://github.com/kepano/obsidian-skills/blob/main/skills/obsidian-cli/SKILL.md) says the CLI "Requires Obsidian to be open". It also teaches a plugin-development loop: `plugin:reload` → `dev:errors` → `dev:screenshot`.

### Markdown as agent memory

- **Claude memory tool** (`memory_20250818`, [docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)): a client-side tool with six commands: `view` (directory listing, or file contents with line numbers and `view_range`), `create`, `str_replace` (which fails on multiple matches), `insert` (after a line), `delete` (recursive) and `rename` (which fails if the destination exists). The docs require path-traversal protection and recommend caps on file size and on how much `view` returns.
- **Claude Code memory** ([docs](https://code.claude.com/docs/en/memory)): CLAUDE.md/AGENTS.md with `@path` imports up to four hops deep. Auto memory lives at `~/.claude/projects/<project>/memory/` with a `MEMORY.md` index ("one line per memory") plus topic files. Only the first 200 lines or 25KB of the index load at session start.
- **Letta context repositories** ([blog, 2026-02-12](https://www.letta.com/blog/context-repositories); [MemFS docs](https://docs.letta.com/letta-code/memfs)):
  - Memory is git-backed Markdown with YAML frontmatter `description`, using progressive disclosure through the file tree.
  - Subagents write in parallel through git worktrees.
  - There is no vector index by default; semantic search needs QMD.
  - Letta [memory blocks](https://docs.letta.com/guides/agents/memory-blocks) carry label, description, a character limit and `read_only`, and concurrent writes are last-write-wins.
- **Basic Memory** ([repo](https://github.com/basicmachines-co/basic-memory), AGPL-3.0, 4.1k stars):
  - Markdown is the source of truth. A SQLite/FTS5 index uses SHA-256 change detection, a file watcher and a rebuild via `basic-memory sync` ([how it works](https://mintlify.wiki/basicmachines-co/basic-memory/concepts/how-it-works)).
  - Notes use `- [category] fact` observations and `- relation [[Target]]` relations.
  - Its MCP tools include `move_note`, `delete_note`, `search_notes`, `build_context`, `recent_activity` and `schema_infer`/`schema_validate`/`schema_diff`. Hybrid search uses FastEmbed.
  - Its docs say permalinks are stable across moves *(whether wikilink text is rewritten is unverified)*.
- **Karpathy "LLM Wiki"** ([gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), April 2026):
  - Three layers: immutable raw sources, an LLM-owned wiki, and a schema file (CLAUDE.md/AGENTS.md).
  - Three operations: **ingest** (one source touches 10–15 pages), **query**, and **lint**. Lint checks for contradictions, stale claims, orphan pages, missing cross-references and concepts without a page.
  - Conventions: `index.md` as a catalog and an append-only `log.md`.
  - Scale: an index alone suffices at "~hundreds of pages"; past that, use qmd.
- **qmd** ([repo](https://github.com/tobi/qmd)): local search combining BM25 (FTS5), vectors via sqlite-vec, and hybrid search with LLM query expansion and reranking (GGUF models). It runs as an MCP server and supports `--format json|csv|md|files`. Forge would need [sqlite-vec](https://github.com/asg017/sqlite-vec) for any vector search, and it is pre-v1 ("expect breaking changes").
- **Research and other systems.** [A-Mem](https://proceedings.neurips.cc/paper_files/paper/2025/hash/19909c36f51abc4856b4560aff3d36d6-Abstract-Conference.html) (NeurIPS 2025) applies Zettelkasten-style linked notes to agent memory. mem0's [OpenMemory MCP](https://mem0.ai/blog/introducing-openmemory-mcp) is local-first and vector-centric *(third-party summaries only for graph features)*. [Smart Connections](https://community.obsidian.md/plugins/smart-connections) provides in-app local embeddings *(its 2026 licence change is reported by a third party and unverified)*.

### Link integrity and vault operations elsewhere

- **[NotesMD CLI](https://github.com/Yakitrak/notesmd-cli)** (formerly "Obsidian CLI", Go, 1.6k stars) works without Obsidian. It provides `move` with vault-wide link updates, `search-content` with JSON output, `daily`, frontmatter edit and delete, and `delete`. It is the closest headless precedent for link-safe renames.
- **[Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)** (3.0k stars, MIT) needs Obsidian running. It offers PATCH targeting a **heading, block reference or frontmatter key** (replace/prepend/append/delete) with `ifMatch` concurrency, JsonLogic metadata search, tags with counts, and a built-in MCP server.
- **[markdown-oxide](https://github.com/Feel-ix-343/markdown-oxide)** (Rust LSP, 2.3k stars) provides backlinks to files, headings and blocks, an action to create unresolved files, and daily notes.
- **[obsidian-linter](https://github.com/platers/obsidian-linter)** (about 2.1k stars) has YAML, heading, footnote, content, spacing and paste rule groups, such as `yaml-key-sort` and `format-tags-in-yaml`. It runs only inside Obsidian *(no CLI found)*.
- **Other formats:**
  - The [Tasks emoji format](https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format) defines dates (➕⏳🛫📅✅❌), priorities, 🔁 recurrence and 🆔/⛔ dependencies.
  - [Dataview](https://blacksmithgu.github.io/obsidian-dataview/) uses inline `[key:: value]` fields, `file.inlinks` and DataviewJS.
  - [Templater](https://silentvoid13.github.io/Templater/) uses `<% tp.* %>` with JavaScript user scripts.
  - The [daily notes](https://obsidian.md/help/plugins/daily-notes) plugin uses a Moment.js format (default `YYYY-MM-DD`), a folder and a template.

## Assessment of The Forge

### Strengths

- **Headless and deterministic.** Forge works without Obsidian, Sync or npm install, which avoids the Obsidian CLI's running-app requirement and its reported exit-code and no-op ambiguity.
- **Mutation safety.** SHA-256 `--if-match`, `--dry-run`, lock-protected batches with rollback, and post-commit events. These go beyond the Local REST API's `ifMatch` and well beyond the memory tool's reference handler.
- **Containment.** The traversal and symlink rejection already meets the memory tool's path-traversal guidance.
- **Format fidelity.** Edits preserve CRLF, BOM, YAML comments, callouts, math and code. Forge validates against the current JSON Canvas 1.0 spec, and the frontmatter checks reject YAML that cannot be represented as JSON.
- **Bases evaluator.** It covers filters, formulas, groupBy/groupOrder and `this` context. The [compatibility profile](../reference/bases.md) is backed by upstream oracle evidence, and unsupported cases fail loudly, as with `AMBIGUOUS_BASE_LINK`. No other headless tool found evaluates Bases.
- **An existing link index.** The indexer in `infrastructure/bases/links.ts` already extracts wikilinks, embeds, Markdown/reference/HTML links and frontmatter links, and it skips code and `%%comments%%`. It also computes tags (including nested) and backlinks. Commands such as backlinks, unresolved and orphans could be built on it at low cost.

### Gaps

| Area | Forge today | Expected by peers |
| --- | --- | --- |
| Lifecycle | create/write/edit only; no delete, rename or move | memory tool `delete`/`rename`; Obsidian CLI `move`/`rename`/`delete`; NotesMD `move` with link updates |
| Link graph | index used only inside Bases queries | `backlinks`, `links`, `unresolved`, `orphans`, `deadends` (Obsidian CLI); Karpathy lint for orphans |
| Search | none | `search:context` path:line (Obsidian CLI); FTS/BM25 (Basic Memory, qmd) |
| Anchors | `resolveBaseLink` drops the `#…` fragment, so heading and block targets are never validated | Obsidian heading/block link rules; markdown-oxide heading/block references |
| Aliases | `aliases` is typed but not used to resolve links | Obsidian CLI `aliases`; `file=` resolves the way a wikilink does |
| Properties | merge-only; `null` writes YAML null; no removal, inventory or type check | `property:remove`, `properties`, `tags` (Obsidian CLI); `schema_validate` (Basic Memory) |
| Section edits | append or one literal replace | heading/block/frontmatter PATCH (Local REST API); line `insert` (memory tool) |
| Bases output | file paths only | rows, values and summaries in json/csv/md (Obsidian CLI `base:query`); 1.14 kanban |
| Periodic notes and tasks | only templates with `--date` | `daily:*`, `tasks` (Obsidian CLI) |
| Coordination | lock ignores Obsidian and Headless Sync | Headless `--continuous` sync writes the same files |

## Recommendations

| ID | Recommendation | Priority | Effort | Rationale and evidence |
| --- | --- | --- | --- | --- |
| KV-1 | Add `move <from> <to>` / `rename` that rewrites inbound references. Covered references: wikilinks, embeds, Markdown/reference links, quoted frontmatter links and Canvas `file` nodes. `#Heading` and `#^block` subpaths and display text are preserved. The dry-run lists every rewritten file with its revision; the commit runs as one locked batch with `file.moved` events. Refuse to overwrite an existing destination. | P0 | M | This is table stakes: Obsidian updates links on rename by default ([links](https://obsidian.md/help/links)), and so do the [Obsidian CLI](https://obsidian.md/help/cli) and [NotesMD](https://github.com/Yakitrak/notesmd-cli). The memory tool requires `rename` ([docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)). The existing indexer supplies link positions. |
| KV-2 | Add `delete <path>` with `--if-match`. Report inbound backlinks and refuse while they exist unless `--allow-broken-links` is passed; support recursive folder delete; never delete the scope root. | P0 | S | Memory tool `delete` is recursive and protects the root. The [Obsidian CLI](https://obsidian.md/help/cli) has `delete`. The brief lists deletion as missing. |
| KV-3 | Add a `links` command group built on the existing index: `links out <note>`, `links back <note>`, `links unresolved`, `links orphans`, `links deadends`. Output is JSON with source line and offset. | P0 | S | This matches the Obsidian CLI Links group, and orphan detection is a core LLM-Wiki lint step ([gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)). The code already exists in `links.ts`. |
| KV-4 | Add `search <query>`: literal or `--regex`, with `--path`/`--tag`/`--property` filters and results as path, line, column and snippet. Order results deterministically, and skip frontmatter and code via flags. | P0 | M | The Obsidian CLI `search:context` returns `path:line: text`. Every memory system ([Basic Memory](https://github.com/basicmachines-co/basic-memory), [qmd](https://github.com/tobi/qmd), [MemFS](https://docs.letta.com/letta-code/memfs)) provides keyword search as a baseline. |
| KV-5 | Add a `vault check` lint that reports without fixing. It covers: unresolved links; missing heading or block anchors; duplicate or invalid block IDs; ambiguous basenames; properties that violate their declared type; deprecated `tag`/`alias`/`cssclass`; unquoted wikilinks in properties; Canvas file nodes pointing at missing files. Errors carry codes, and the command exits 2 on findings. | P1 | M | It enforces the rules in Obsidian [links](https://obsidian.md/help/links) and [properties](https://obsidian.md/help/properties), and corresponds to the Karpathy lint operation. Today `formats.md` says Canvas file existence "is not checked". |
| KV-6 | Add `tags` and `properties --inventory` (counts, observed types, conflicts with `.obsidian/types.json`) and `properties --unset key`. | P1 | S | Mirrors the Obsidian CLI `tags`, `properties` and `property:remove` and Basic Memory's `schema_infer`/`schema_validate`. Removal currently needs a full guarded write. |
| KV-7 | Add `outline <note>` (headings and block IDs with line numbers). Extend `edit` with section targets: `--heading "A#B"`, `--block id`, `--line N`, each with append/prepend/replace. | P1 | M | Equivalent to the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) PATCH targets, the memory tool `insert` and the Obsidian CLI `outline` json. It reduces fragile literal find/replace. |
| KV-8 | Add `bases query --rows`: return evaluated `order` columns, formula values, groups and summaries, with `--format json\|csv\|md`. Keep `files` as the default. Track the 1.14 `kanban` view and summary syntax in the capability profile. | P1 | M | The Obsidian CLI `base:query` emits json/csv/tsv/md/paths. Summaries and kanban are documented ([syntax](https://obsidian.md/help/bases/syntax), [1.14.0](https://obsidian.md/changelog/2026-09-02-desktop-v1.14.0/)). |
| KV-9 | Add bulk property migration: `properties --set/--unset` across `--base <file> --view <name>` or a path glob, with a planned diff per file and an `--if-match` map, committed as one batch. | P1 | S | One Forge invocation can replace many Obsidian CLI calls, which reportedly have no batching and take about a second each ([third-party guide](https://www.dsebastien.net/the-complete-guide-to-the-obsidian-cli-everything-you-can-do-from-the-terminal/)). Builds on the existing batch machinery. |
| KV-10 | Add `daily [--date ISO] [--create] [--append text]`, resolving folder, Moment format and template from vault config with explicit flag overrides. | P1 | S | Matches the Obsidian CLI `daily:*` and [NotesMD](https://github.com/Yakitrak/notesmd-cli) `daily`. The config file location is not in the official [help](https://obsidian.md/help/plugins/daily-notes), so verify it before relying on it. |
| KV-11 | Add a memory profile: document how the six memory-tool commands map to Forge commands, and ship a `forge-memory` skill. It should cover an `index.md`/`MEMORY.md` index plus an append-only `log.md`, frontmatter `description`, and size checks that warn when an index exceeds 200 lines or 25KB. | P2 | S | The [memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool), [Claude Code auto memory](https://code.claude.com/docs/en/memory), [Letta](https://www.letta.com/blog/context-repositories) and the Karpathy gist converge on this layout. Depends on KV-1 and KV-2. |
| KV-12 | Add `tasks [--status open\|done] [--due-before DATE]` that parses checkboxes and Tasks emoji fields into JSON. Parsing is read-only. | P2 | M | Matches the Obsidian CLI `tasks` and the [Tasks format](https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format). It is useful for planning workflows, which Forge's PRD/release templates already produce. |
| KV-13 | Offer semantic and hybrid search through an optional plugin or adapter that delegates to an external indexer (qmd or similar). Do not bundle models. | P2 | L | [qmd](https://github.com/tobi/qmd) and Basic Memory already provide this, and [sqlite-vec](https://github.com/asg017/sqlite-vec) is pre-v1. The LLM-Wiki gist says an index file is enough up to hundreds of pages. |
| KV-14 | Document coexistence with Obsidian. Prefer the Obsidian CLI `move` when the app is running. Do not run Forge writes while `ob sync --continuous` is active without guards. Re-read revisions after a sync. | P2 | S | Covers the [Headless Sync](https://obsidian.md/help/sync/headless) conflict warnings and Forge's lock limitation documented in `cli.md`. |

## What not to build

- **Sync, Publish or history.** Obsidian Headless covers these officially, with E2EE.
- **Bundled embedding models or a vector store in `bin/app.js`.** They would bloat the single-file bundle and duplicate qmd and Basic Memory. Expose a plugin seam instead (KV-13).
- **Execution of DataviewJS, Templater `<% %>` or Obsidian CLI-style `eval`.** These contradict Forge's "never executes expressions or scripts" contract. Treat that syntax as opaque text.
- **A formatter that normalizes note style** (obsidian-linter-style rewrites). It conflicts with source preservation; KV-5 should report problems, not reformat.
- **A mandatory memory schema** such as Basic Memory's observation and relation grammar. Keep plain Obsidian Markdown and let skills recommend conventions.
- **Silent heuristics for ambiguous links.** Keep the explicit `AMBIGUOUS_BASE_LINK`-style failure rather than guessing.
- **Graph visualization or a GUI.** Obsidian is the viewer ("the IDE" in Karpathy's framing).

## Open questions

1. Obsidian's own rule for ambiguous basenames is not documented in the help pages I fetched. Should Forge keep failing, or emulate Obsidian's choice, once that choice is verified?
2. What should `move` rewrite beyond Markdown? Candidates are `.base` string literals (`file.inFolder("x")`, `link("x")`) and Canvas `file` paths. Rewriting expressions risks semantic changes.
3. The `.obsidian/types.json` and daily-notes config formats are undocumented officially. Should Forge read them only with explicit flags, or record them as "observed behaviour" in its capability profile?
4. Performance: Forge rebuilds the index and holds files in memory on every invocation. What is the latency at 5k–20k notes, and is a cached, revision-keyed index needed before KV-3 and KV-4 ship?
5. Is a memory-tool-shaped JSON adapter (paths under `/memories` mapped to a Forge scope) in scope, or does that belong with the deferred MCP server?
6. Should a block ID for an edit target be created automatically, as Obsidian does when linking to a block, or must it already exist?

## Sources

- Obsidian CLI reference: https://obsidian.md/help/cli
- Obsidian 1.12.4 changelog: https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/
- Obsidian 1.10.0 changelog: https://obsidian.md/changelog/2025-10-01-desktop-v1.10.0/
- Obsidian 1.13.0 mobile changelog: https://obsidian.md/changelog/2026-05-28-mobile-v1.13.0/
- Obsidian 1.14.0 changelog: https://obsidian.md/changelog/2026-09-02-desktop-v1.14.0/
- Obsidian changelog index: https://obsidian.md/changelog/
- Obsidian Headless: https://obsidian.md/help/headless
- Obsidian Headless Sync: https://obsidian.md/help/sync/headless
- Bases syntax: https://obsidian.md/help/bases/syntax
- Bases functions: https://obsidian.md/help/bases/functions
- Bases views: https://obsidian.md/help/bases/views
- Bases plugin API (search result): https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerBasesView
- Properties: https://obsidian.md/help/properties
- Internal links: https://obsidian.md/help/links
- Obsidian Flavored Markdown: https://obsidian.md/help/obsidian-flavored-markdown
- Daily notes: https://obsidian.md/help/plugins/daily-notes
- JSON Canvas: https://jsoncanvas.org/
- kepano/obsidian-skills: https://github.com/kepano/obsidian-skills
- obsidian-cli skill: https://github.com/kepano/obsidian-skills/blob/main/skills/obsidian-cli/SKILL.md
- Obsidian CLI guide (third-party): https://www.dsebastien.net/the-complete-guide-to-the-obsidian-cli-everything-you-can-do-from-the-terminal/
- Claude memory tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- Claude Code memory: https://code.claude.com/docs/en/memory
- Letta context repositories: https://www.letta.com/blog/context-repositories
- Letta MemFS: https://docs.letta.com/letta-code/memfs
- Letta memory blocks: https://docs.letta.com/guides/agents/memory-blocks
- Basic Memory: https://github.com/basicmachines-co/basic-memory
- Basic Memory, how it works: https://mintlify.wiki/basicmachines-co/basic-memory/concepts/how-it-works
- Karpathy LLM Wiki gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- qmd: https://github.com/tobi/qmd
- sqlite-vec: https://github.com/asg017/sqlite-vec
- A-Mem (NeurIPS 2025): https://proceedings.neurips.cc/paper_files/paper/2025/hash/19909c36f51abc4856b4560aff3d36d6-Abstract-Conference.html
- OpenMemory MCP (search result): https://mem0.ai/blog/introducing-openmemory-mcp
- Smart Connections listing (search result): https://community.obsidian.md/plugins/smart-connections
- NotesMD CLI: https://github.com/Yakitrak/notesmd-cli
- Obsidian Local REST API: https://github.com/coddingtonbear/obsidian-local-rest-api
- markdown-oxide: https://github.com/Feel-ix-343/markdown-oxide
- obsidian-linter: https://github.com/platers/obsidian-linter
- Tasks emoji format: https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format
- Dataview: https://blacksmithgu.github.io/obsidian-dataview/
- Templater: https://silentvoid13.github.io/Templater/
