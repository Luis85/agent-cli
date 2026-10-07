# Obsidian file contract

[Documentation](../index.md) · Reference

The native inventory follows [Obsidian accepted file formats](https://help.obsidian.md/Files+and+folders/Accepted+file+formats), checked on 2026-10-07. Unknown extensions and `.obsidian` configuration files can also be copied/replaced as opaque bytes; community-plugin semantics are not inferred.

| Format | Extensions | Processing |
| --- | --- | --- |
| Markdown | `.md` | UTF-8 text, YAML frontmatter parsing/merge, literal edits, append, full replacement |
| JSON Canvas | `.canvas` | JSON graph inspection, structural validation, pointer edits, full replacement |
| Bases | `.base` | YAML parsing, structural validation, pointer edits, full replacement |
| Images | `.avif .bmp .gif .jpeg .jpg .png .svg .webp` | Lossless byte/base64 read, copy, create, replace, embed as note text |
| Audio | `.flac .m4a .mp3 .ogg .wav .webm .3gp` | Same byte operations |
| Video | `.mkv .mov .mp4 .ogv .webm` | Same byte operations |
| PDF | `.pdf` | Same byte operations |

`.webm` belongs to both audio and video; the simple list/read classifier reports `audio`. Extension matching is case insensitive. Attachment validation does not decode or verify a media container, and no embedded HTML/SVG/script is executed. Audio/video playback, image transformations, PDF editing, OCR, indexing and extracted text require a plugin or an external tool.

## Markdown

Markdown body content is treated as source text, preserving Obsidian wikilinks, embeds, tags, block references, callouts, tasks, math and fenced code without needing a renderer. Frontmatter must be a YAML mapping with unique keys and a closing `---` delimiter. Markdown structure is parsed with unified/remark and YAML with the YAML library. Property edits retain the body and YAML comments; edited frontmatter formatting may normalize. BOM and CRLF body text are retained. A frontmatter edit merges keys; use a guarded complete write to remove keys. YAML expressions are never executed.

Frontmatter and Bases must use JSON-compatible YAML: string mapping keys, finite numbers, strings, booleans, nulls, arrays and plain mappings. Cyclic aliases, explicit binary/timestamp objects and excessive nesting are rejected rather than silently losing data in JSON responses. Bounded noncyclic aliases work. A pointer edit cannot traverse an alias; replace the alias or edit its anchor, understanding that anchor changes affect all aliases referring to it.

## Canvas

The validator follows [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/): optional node/edge arrays; unique node IDs and edge IDs within their respective collections; text, file, link, and group nodes; integer geometry; valid colors, edge sides/ends, and existing edge endpoints. This CLI additionally requires positive dimensions and nonempty IDs. Unknown extension fields are preserved. Referenced file existence and URL reachability are not checked. JSON formatting normalizes on pointer edits. A Canvas with currently missing edge targets must be repaired by a complete valid write.

## Bases

The structural contract follows [Obsidian Bases syntax](https://help.obsidian.md/bases/syntax). The file must be a mapping; views contain type/name; formula, property and summary sections are mappings; filter structures are checked. AST edits preserve YAML comments and unrelated keys. Plugin-added view types and extra view properties are retained. The CLI stores expressions as data and does not evaluate filters, formulas, summaries, backlink resolution, or the Obsidian vault query engine. Structural validation cannot establish formula correctness or guarantee rendering in every Obsidian version.
