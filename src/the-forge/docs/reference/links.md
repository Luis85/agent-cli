# Links

[Documentation](../index.md) · Reference

`links` reports the link graph of the command scope (the selected project, or the workspace when none is selected) from the kernel [metadata index](formats.md#metadata-index): one file's outgoing links and backlinks, every unresolved link, orphaned notes and dead ends. It is read-only and contributed by the `links` [core plugin](plugins.md#core-and-user-plugins) (`src/plugins/links/` in the Forge source), enabled by default; `plugins.disabled: ["links"]` removes it.

```sh
node bin/forge.js links out notes/plan.md
node bin/forge.js links back notes/plan.md
node bin/forge.js links unresolved --path "projects/**"
node bin/forge.js links orphans
node bin/forge.js links deadends --path "notes/*"
```

## Command contract

| Action | Result |
| --- | --- |
| `links out <path>` | `{path, links, issues}`: every reference in the file, in document order: body links and embeds, then frontmatter links, then Canvas file nodes |
| `links back <path>` | `{path, backlinks, issues}`: references in other files that resolve to the file, by source path and then reference order. Self-links are not backlinks |
| `links unresolved [--path glob]` | `{links, issues}`: every missing or ambiguous reference, by source path and then reference order; `--path` selects the sources |
| `links orphans [--path glob]` | `{files, issues}`: Markdown and Canvas notes that no other file links to or embeds, except configured roots |
| `links deadends [--path glob]` | `{files, issues}`: parsed Markdown and Canvas notes without a reference to another file |

`<path>` is the root-relative path of a visible file, for example `notes/plan.md`; link text such as `Plan` is not resolved here. A missing or dot-prefixed path fails with `NOT_FOUND`. Attachments have backlinks but no outgoing links. `--path` takes a [path glob](cli.md#path-globs-and-paging) and is rejected by `out` and `back`. Every action reads the current files and publishes no `vault.*` records.

Each link is reported as:

```json
{
  "source": "Home.md", "kind": "link", "line": 2, "column": 1, "offset": 7,
  "original": "[[Ideas]]", "link": "Ideas", "displayText": "Ideas",
  "status": "unresolved", "reason": "ambiguous", "candidates": ["Archive/Ideas.md", "Notes/Ideas.md"]
}
```

| Field | Meaning |
| --- | --- |
| `source` | The file that contains the reference |
| `kind` | `link`, `embed` (`![[…]]` and Markdown image embeds), `frontmatter` (a link in a property value) or `canvas` (a Canvas `file` node) |
| `line`, `column`, `offset` | For `link` and `embed`: the 1-based line and column where `original` starts, and its zero-based character offset in the file. Columns and offsets count UTF-16 code units, including the frontmatter block and any byte order mark |
| `key`, `node` | For `frontmatter`: the dotted property path with list indexes (`related[0]`). For `canvas`: the node id |
| `original`, `link`, `displayText` | The source text, the link text without display text (`Note#Heading`), and the display text |
| `status` | `resolved`, `unresolved` or `external` (a URL; never counted as unresolved) |
| `target`, `via` | For `resolved`: the target path, and `path` or `alias` |
| `reason`, `candidates` | For `unresolved`: `missing`, or `ambiguous` with the equally good matches in path order. Forge reports an ambiguity rather than choosing like Obsidian does |

Resolution follows the [metadata index rules](formats.md#metadata-index): exact paths with or without `.md`, then one case-insensitive match, then one path-suffix match for vault-style links, then one alias. Relative Markdown links resolve from their source folder.

`issues` lists files the metadata index could not parse (`{path, code, message}`), for example Markdown with invalid frontmatter. Their own references are missing from every report, so an issue can hide a backlink or make a note look orphaned; `out` reports only the requested file's issue. Fix the file and run the report again.

## Orphans and dead ends

A note is a Markdown or Canvas file. It is an orphan when no other file links to it, embeds it, names it in a frontmatter link or places it in a Canvas file node. Unresolved and ambiguous links do not count as inbound links. A home or index note is usually an orphan by design: list such entry notes as path globs in `plugins.settings.links.roots` in `bin/config.json`, and `links orphans` never reports them:

```json
{ "plugins": { "settings": { "links": { "roots": ["Home.md", "maps/**"] } } } }
```

Roots default to `[]`; an empty string or a malformed glob, such as the reversed class `[z-a]`, fails with `INVALID_CONFIG` when the configuration loads, naming the root in `error.details.issues`. Roots affect only `orphans`.

A dead end is a parsed note without any reference to another file. Unresolved and ambiguous links count as references, because they are links the author wrote; `links unresolved` reports them. External URLs and links to the note itself (`[[#Heading]]`) do not count. Unparseable notes are never dead ends; they appear in `issues`.
