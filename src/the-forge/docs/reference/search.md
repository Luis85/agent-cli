# Search

[Documentation](../index.md) · Reference

`search` finds literal text or a regular expression in the text files of the command scope (the selected project, or the workspace when none is selected) and returns hits with path, line, column, snippet and the file's revision. It is read-only and contributed by the `search` [core plugin](plugins.md#core-and-user-plugins) (`src/plugins/search/` in the Forge source), enabled by default; `plugins.disabled: ["search"]` removes it.

```sh
node bin/forge.js search "release plan"
node bin/forge.js search "^#+ Risks" --regex --kind markdown --in body
node bin/forge.js search TODO --path "src/**" --case-sensitive --context 2
node bin/forge.js search owner --tag project/alpha --property status=active --in frontmatter
node bin/forge.js search plan --limit 20 --cursor <nextCursor>
node bin/forge.js search -- --dry-run
```

## Command contract

| Option | Effect |
| --- | --- |
| `<pattern>` | Literal text by default; matched case-insensitively. Use `--` before a pattern that starts with `-` |
| `--regex` | Treat the pattern as a JavaScript regular expression with the `u` flag; `^` and `$` anchor each line |
| `--case-sensitive` | Match case exactly |
| `--in body / frontmatter / all` | Markdown lines to read: `body` is everything after the frontmatter, `frontmatter` the lines between its `---` delimiters, `all` (default) the whole file. Other kinds have no frontmatter: `frontmatter` finds nothing in them |
| `--skip-code` | Skip fenced and indented Markdown code blocks, as the [metadata cache](formats.md#metadata-index) records them |
| `--kind markdown / canvas / base / text` | Only files of this kind; attachment kinds are rejected with `INVALID_ARGUMENT` |
| `--path <glob>` | Only files whose root-relative path matches the [path glob](cli.md#path-globs-and-paging) |
| `--tag <tag>` | Only notes with the tag or a nested tag below it (`project` matches `#project/alpha`), case-insensitively, with or without `#`; inline and frontmatter tags count |
| `--property <key>` / `--property <key>=<value>` | Only notes whose top-level frontmatter has `key` with a non-null value, or whose value (or any scalar list element) has exactly the text `value` |
| `--context <n>` | Up to `n` lines (0–50, default 0) before and after each hit, as `before` and `after` |
| `--limit <n>` | Hits per page, default 100 |
| `--cursor <token>` | Continue after the page that returned this `nextCursor`; see [paging](cli.md#path-globs-and-paging) |

The result is `{hits, total, nextCursor?}`:

```json
{
  "hits": [
    { "path": "notes/plan.md", "line": 6, "column": 16, "match": "plan", "snippet": "Ship the beta plan.", "before": ["# Plan"], "after": [""], "revision": "3b1f…" }
  ],
  "total": 1
}
```

- `line` and `column` are 1-based; columns count UTF-16 code units of the line, like JavaScript string indexes. A leading byte order mark is not counted.
- `match` is the matched text; `snippet` is the whole line, or for lines over 200 characters the 80 characters around the match with `…` where text was cut. `before` and `after` lines are cut to their first 200 characters.
- `revision` is the file's SHA-256 revision when it was searched; pass it as `--if-match` to `edit` or `write` so a change since the search fails with `CONFLICT`.
- `total` counts every hit of the query, across all pages. `nextCursor` is present only when more hits follow.

Hits are ordered by path (code-unit order, as `list` reports), then line, then column. Each line matches independently: patterns cannot span lines. A line can hold several hits; empty matches (for example of `x*`) are not hits.

## What is searched

Search reads visible files of the kinds `markdown`, `canvas`, `base` and `text` (the [text extensions](formats.md#utf-8-text)). It never reads attachments, files below a dot-prefixed folder or with a dot-prefixed name (`.obsidian`, `.trash`, `.forge`), `.git` or `node_modules`, and it skips files whose bytes are not valid UTF-8. Canvas and Bases files are searched as their JSON or YAML text. Tag, property and `--skip-code` filters load the metadata cache; a note that cannot be parsed has no metadata, so it fails tag and property filters and its code blocks are not skipped.

Searching reads files through the repository port: it publishes no `vault.*`, `workspace.file-open` or `operation.*` records and takes no writer lock. Each invocation reads the current files; there is no persistent index.

## Regular-expression safety

JavaScript regular expressions backtrack, and a pattern such as `^(a+)+$` can take exponential time on a long line. Search bounds matching instead of guessing which patterns are dangerous: matching runs inside a `node:vm` timeout whose watchdog interrupts even a running regular expression, and path filtering and all files of one search share one budget. When the budget is spent, the search fails with `SEARCH_TIMEOUT` (exit 2, `details.timeoutMs`) rather than returning partial results. Reading files does not count against the budget. Patterns are limited to 1,000 characters.

The budget is `plugins.settings.search.timeoutMs` in `bin/config.json` (default `10000`, 100 to 600000 milliseconds):

```json
{ "plugins": { "settings": { "search": { "timeoutMs": 30000 } } } }
```

To recover from a timeout, avoid nested quantifiers and ambiguous alternations, narrow the files with `--path` or `--kind`, or search literally.

## Errors

| Code | Exit | When |
| --- | --- | --- |
| `INVALID_SEARCH_PATTERN` | 2 | Empty or overlong pattern, or an invalid regular expression (the message names the syntax error) |
| `SEARCH_TIMEOUT` | 2 | Matching exceeded `plugins.settings.search.timeoutMs` |
| `INVALID_ARGUMENT` | 2 | Unknown `--in` or `--kind`, `--context` outside 0–50, a `--limit` below 1, a malformed `--property` or `--tag`, a malformed glob, or a cursor of another query |

Both search codes are registered by the plugin, so `schema` lists them with `plugin: "search"` and `--lang de` localizes their summary and hint. See the [error catalog](errors.md#core-plugin-codes).
