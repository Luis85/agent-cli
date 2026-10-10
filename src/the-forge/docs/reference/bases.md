# Bases repositories

[Documentation](../index.md) · Reference

A native Obsidian `.base` file and one of its named views define a repository of matching vault files. `bases query` evaluates that definition inside the selected Forge project or workspace and returns a JSON list of relative file paths. It runs entirely in the bundled Node CLI: Obsidian, a desktop session and runtime npm installation are not required. The `bases` command is contributed by the `bases` [core plugin](plugins.md#core-and-user-plugins) (`src/plugins/bases/` in the Forge source), enabled by default; `plugins.disabled: ["bases"]` in `bin/config.json` removes the command from `help`, `schema` and dispatch, while `.base` files remain ordinary documents for `read`, `validate` and `patch`. The plugin also provides the `bases.query` service, through which the [backlog](backlog.md) plugin evaluates its view; disabling `bases` disables `backlog` as well.

```sh
node bin/forge.js bases list
node bin/forge.js bases inspect repositories/tasks.base
node bin/forge.js bases query repositories/tasks.base --view Open
node bin/forge.js bases query repositories/tasks.base --view Open --context projects/Alpha.md --limit 20
node bin/forge.js bases capabilities
```

## Command contract

| Command | Result |
| --- | --- |
| `bases list` | Visible `.base` paths in the current scope. |
| `bases inspect <path.base>` | Native definition, views and content revision. Does not evaluate expressions. |
| `bases query <path.base>` | `files`, `total`, `warnings`, selected `path`/`view`/`context`, `repository`, scope and compatibility profile. |
| `bases capabilities` | Pinned evaluator, upstream oracle evidence, supported operations and explicit limitations. |

`--view` selects an exact, case-sensitive view name. Omitting it selects the first view in the file. Missing views and duplicate view names fail. `--context` selects an existing visible vault file for `this`; by default this is the `.base` file. This lets callers reproduce an embedding note's context explicitly. There is no implicit active-editor context. `--limit` is a nonnegative safe integer; zero returns an empty list. The command limit and the view's native limit both apply, using the smaller value. `total` counts matches after filters and group visibility, before either limit.

All commands are read-only. Querying neither rewrites the Base nor emits `vault.*` events. For changes, use ordinary guarded `write`, `properties` or `patch` operations. Paths use the existing contained workspace rules; symlinks and traversal cannot become query inputs or escape through link resolution.

## Native repository definition

Save this as `repositories/tasks.base`. It is ordinary [Bases YAML](https://obsidian.md/help/bases/syntax), editable in Obsidian:

```yaml
filters:
  and:
    - file.ext == "md"
    - file.inFolder("tasks")
formulas:
  score: priority * 2
views:
  - type: table
    name: Open
    filters: status != "done"
    order:
      - file.name
      - status
      - formula.score
    sort:
      - property: formula.score
        direction: DESC
    limit: 50
```

`order` controls displayed columns in Obsidian; `sort` orders returned files. Global and selected-view filters are combined with AND. Nested `and`, `or` and `not` lists work; `not` matches when none of its children match. Formulas can reference other formulas, including names accessed with literal brackets. Circular formulas and invalid expressions fail. Built-in expressions include typed dates/durations, arithmetic, regexes, file/link methods and list operations such as `filter`, `map` and `reduce` through the established evaluator.

`groupBy` orders groups using its property and `ASC`/`DESC` direction. `groupOrder`, when present, restricts visible groups to the listed values and orders them accordingly; an empty list hides all groups. Within groups, `sort` applies. Without explicit ordering, and for equal sort values, paths provide a stable tie-breaker. Numeric/date/boolean values use typed comparison; strings use the host locale's natural collation. Display names, column widths, summaries and other presentation settings do not affect the returned file list.

## File context

The index includes visible Markdown and attachment files. Dot-prefixed files and directories are excluded, including `.obsidian`, `.claude` and `.git`; `node_modules` and Forge's temporary/lock files are also excluded by the repository. A native `.claude/agents` directory is therefore not a normal Bases repository. Use visible authoring copies when managing those definitions through Obsidian; see [Claude Code management](claude.md).

File context includes paths, names/extensions, folder, byte size, filesystem creation/modification dates, tags, internal links, embeds and deduplicated backlink sources. Markdown frontmatter supplies note properties. Native property types come from `.obsidian/types.json`, which is read explicitly despite the configuration folder being excluded from results. Text, list, tags, aliases, number, checkbox, date and datetime types are recognized.

Tags, links and frontmatter come from the kernel [metadata index](formats.md#metadata-index). Inline/frontmatter tags include nested-tag matching. Wikilinks, frontmatter wikilink values, internal Markdown links, reference links and embedded attachments participate in link indexing. Code spans/blocks, comments, math and external URLs do not. Relative Markdown links resolve from their source note. A link whose path matches several files (such as `[[README]]` with `archive/README.md` and `docs/README.md`) resolves to the closest candidate, as Obsidian opens it: the file whose folder is the fewest folder steps from the source note's folder (up to their deepest common folder, then down), then the one with the fewest path segments, then the first in path order. Links that match only a note alias stay unresolved in Bases, and Canvas file nodes are not Bases links. Standard HTML anchors and media source attributes also participate in indexing; scripts are never executed.

`this.file` refers to the selected context file. `this.property`, literal-bracket access, and comparisons between a link and `this` use that same context. For example, `file.hasLink(this.file)` returns notes linking to the context file. Queries build a new filesystem index on each invocation; no live refresh or transactional vault snapshot is provided.

## Compatibility and errors

The bundle uses MIT-licensed [`obsidian-bases-expression` 0.2.0](https://github.com/callumalpass/obsidian-bases-expression), an independent parser and AST evaluator. User expressions are not executed as JavaScript. Its published profile records 281 upstream live-Obsidian oracle cases from June 10, 2026, with five documented divergences; version/build metadata is absent and the corpus was not repeated across Obsidian versions. This is compatibility evidence, not a guarantee of complete parity. Forge's own tests use filesystem fixtures and do not open Obsidian.

Forge rejects unary plus and direct numeric method syntax, which the upstream library accepts despite its observed native-parser differences; parenthesized numeric method receivers work. The adapter also preserves native `not` semantics, strict filter errors, context-file properties, case-insensitive tags and literal/dynamic formula references with cycle guards. Community-plugin functions and view-specific query behavior are not loaded. A query using unsupported functionality should be checked against `bases capabilities`; no plugin runtime or presentation rendering is implied. See [upstream compatibility notes](https://github.com/callumalpass/obsidian-bases-expression/blob/main/docs/compatibility.md) and the official [function reference](https://obsidian.md/help/bases/functions).

One note never fails the whole query, as in Obsidian. `warnings` lists, in path order, every note of the scope that was indexed with less than its full metadata, each `{code, path, message}`:

| Code | Meaning |
| --- | --- |
| `unparseable-note` | The note cannot be parsed, for example because of duplicate frontmatter keys or an unclosed flow sequence. It is indexed without properties, links or tags, so it still matches file-only filters such as `file.inFolder(...)`. |
| `ambiguous-link` | A link path matches several files (`candidates`) and resolves to the closest, `resolvedPath`; `link` is the link path. |

Invalid expressions use `INVALID_BASE_EXPRESSION`; expression evaluation failures identify the Base, view and affected file through `BASE_EVALUATION_ERROR`. Invalid property-type settings and missing contexts have named errors. Fix the reported source and query again; errors are not converted into a successful empty repository.

## Generated Markdown

Generated Markdown stays native source: YAML frontmatter, wikilinks, named-view Base embeds such as `![[repositories/tasks.base#Open]]`, and fenced `base` blocks remain editable. Template generation and property-edit tests preserve the authored body, including CRLF/BOM, callouts, code, math, tasks and attachment embeds. Nested YAML configuration requires Obsidian Source mode because its Properties UI supports a narrower set of property shapes. These tests establish source preservation; actual Obsidian rendering and plugin-dependent behavior have not been verified. See [format contracts](formats.md).
