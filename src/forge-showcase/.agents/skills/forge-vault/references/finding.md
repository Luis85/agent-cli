# Finding and checking vault files

Read this for bounded reads, search and list paging, link reports and vault checks.

## Reads
- Markdown `read` returns `content` and `properties`; `--parts properties` returns only the frontmatter and `--parts body` only the body.
- Text and attachment content beyond 256 KiB (`--max-bytes`) is cut with `truncated: true`, `lines: {start, end, total}` and a warning. `--lines <start>-<end>` (1-based, inclusive; also `<start>-` or `<start>`) reads a range; `search` hits report the line numbers. When one line alone exceeds the limit (warning `READ_LINE_TRUNCATED`), `--lines` returns the same prefix again: raise `--max-bytes` to `details.lineBytes`.
- `read-many <paths…>` reads 1-32 paths in order, each counting at most `--max-bytes` toward an 8 MiB total. Any failure rejects the whole bundle, with `details.index` and `details.path`. It is not an atomic snapshot.
- `stat <path>` returns a file's revision and byte count, or a folder's revision and counts, without parsing. It also works when `read` fails on malformed frontmatter.

## Search and list
- `search "release plan"` returns `data.hits` (`path`, 1-based `line` and `column`, `match`, `snippet`, `revision`) in path, line and column order, with `total`. A hit's `revision` is the `--if-match` for an `edit` of that file.
- Narrow with `--path notes` (a folder path selects everything below it; globs such as `notes/**/*.md` work too), `--kind markdown`, `--tag project`, `--property status=active`, `--in body`, `--skip-code` and `--context 2`.
- `--exclude "**/{dist,coverage}/**"` skips files before they are read and wins over `--path`. Search ignores `.gitignore`.
- Matching ignores case unless `--case-sensitive`; `--regex` takes a JavaScript regular expression per line. `SEARCH_TIMEOUT` means the expression backtracks too much.
- `--files-only` returns `files: [{path, revision, hits}]` and `--count` only `total` and `fileCount`.
- `list --path notes --kind markdown` lists files; `list --tag` and `--property` find notes without a pattern. `.trash` is hidden unless `--include-trash`.
- Pages hold 500 files or 100 hits: repeat the same command with `--cursor <nextCursor>` until it is absent. A `--path` that matches nothing adds a warning.

## Links
- `links back <note>` lists every file that links to it (`source`, `line`, `column`, `original`); `links out <note>` lists its links with `status` and `target`.
- `links unresolved --path "notes/**"` reports broken links with `reason` `missing`, or `ambiguous` with `candidates`: use a longer link path.
- `links orphans` lists notes nothing links to and `links deadends` notes that link nowhere; list intended entry notes in `plugins.settings.links.roots`.
- Every report has `issues`: files whose metadata could not be parsed. Fix those first.

## Vault check
- `vault check` returns `data.findings` (`rule`, `severity`, `path`, `line`, `column`, `message`, `hint`, and `suggestion` for a missing target) and `summary` counts.
- Rules: `unresolved-link`, `unresolved-embed`, `ambiguous-link`, `unresolved-anchor`, `invalid-frontmatter`, `invalid-canvas`, `invalid-base`, `property-type-mismatch`, `duplicate-block-id`, `empty-file`, `orphan-attachment`.
- Narrow with `--path "notes/**"` and `--rule unresolved-link,invalid-frontmatter`.
- `vault check --strict` fails with `VAULT_CHECK_FAILED` (exit 2) while an `error` finding remains, listed in `error.details.findings`.
- `vault tags --sort count` lists tags with their files; `vault properties --name <property>` shows a property's types. Severities and ignore globs live in `plugins.settings.vault-check`.
