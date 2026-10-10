# Obsidian file contract

[Documentation](../index.md) · Reference

The native inventory follows [Obsidian accepted file formats](https://help.obsidian.md/Files+and+folders/Accepted+file+formats), checked on 2026-10-07. Common source, data and configuration extensions are additionally handled as [UTF-8 text](#utf-8-text). Other extensions, extensionless files, dotfiles such as `.gitignore` and `.obsidian` configuration files can be copied/replaced as opaque bytes; community-plugin semantics are not inferred.

| Format | Extensions | Processing |
| --- | --- | --- |
| Markdown | `.md` | UTF-8 text, YAML frontmatter parsing/merge, literal edits, append, full replacement |
| JSON Canvas | `.canvas` | JSON graph inspection, structural validation, pointer edits, full replacement |
| Bases | `.base` | YAML parsing, structural validation, pointer edits, full replacement, standalone view queries |
| Images | `.avif .bmp .gif .jpeg .jpg .png .svg .webp` | Lossless byte/base64 read, copy, create, replace, embed as note text |
| Audio | `.flac .m4a .mp3 .ogg .wav .webm .3gp` | Same byte operations |
| Video | `.mkv .mov .mp4 .ogv .webm` | Same byte operations |
| PDF | `.pdf` | Same byte operations |
| Text | See [UTF-8 text](#utf-8-text) | UTF-8 read, literal edits, append, full replacement; not a native Obsidian format |

`.webm` belongs to both audio and video; the simple list/read classifier reports `audio`. Extension matching is case insensitive. Attachment validation does not decode or verify a media container, and no embedded HTML/SVG/script is executed. Audio/video playback, image transformations, PDF editing, OCR, indexing and extracted text require a plugin or an external tool.

## Markdown

Markdown body content is treated as source text, preserving Obsidian wikilinks, embeds, tags, block references, callouts, tasks, math and fenced code without needing a renderer. Frontmatter must be a YAML mapping with unique keys and a closing `---` delimiter. Markdown structure is parsed with unified/remark and YAML with the YAML library. Property edits retain the body and YAML comments; edited frontmatter formatting may normalize. BOM and CRLF body text are retained. A frontmatter edit merges keys; use a guarded complete write to remove keys. YAML expressions are never executed.

Frontmatter and Bases must use JSON-compatible YAML: string mapping keys, finite numbers, strings, booleans, nulls, arrays and plain mappings. Cyclic aliases, explicit binary/timestamp objects and excessive nesting are rejected rather than silently losing data in JSON responses. Bounded noncyclic aliases work. A pointer edit cannot traverse an alias; replace the alias or edit its anchor, understanding that anchor changes affect all aliases referring to it.

Generated component, interaction, data-source and Claude agent definitions are ordinary Markdown with YAML frontmatter. Edit their prose, wikilinks, embeds, inline tags and declared configuration directly in Obsidian Source mode, then validate and regenerate the affected output. Generation reads these source notes without rewriting their authored bodies. Generic property edits preserve valid scalar/list types and the body; definition serializers can normalize YAML formatting.

Obsidian's [Properties editor](https://help.obsidian.md/properties) does not support nested properties. Nested component trees, action lists, data-source models and agent hooks therefore require Source mode; valid YAML does not mean every field is editable through the Properties UI. Component, interaction and data-source frontmatter uses a strict schema, so additional top-level fields such as `tags` must not be added unless that schema supports them; use inline body tags for those definitions. Template notes and extensible Claude agent metadata can retain native `tags` lists and quoted property wikilinks. These source/edit/regeneration contracts are tested without claiming Obsidian rendering or plugin behavior has been verified.

File location also matters: Obsidian normally excludes dot-folders such as Claude's native `.claude/agents` from its file tree, metadata index and Bases. The [Hidden Folders Access community-plugin listing](https://community.obsidian.md/plugins/hidden-folders-access) describes this separate indexing limitation. Keep a visible authoring copy when editing an agent in a standard vault, then explicitly apply the edited native source with a revision-guarded Claude agent update. A separately configured indexing integration is another option. Forge preserves Claude's native locations; it does not change Obsidian indexing or automatically synchronize authoring copies.

```sh
node bin/app.js claude agents export reviewer --out definitions/reviewer.md --dry-run
node bin/app.js claude agents export reviewer --out definitions/reviewer.md
node bin/app.js claude agents inspect reviewer
# Edit definitions/reviewer.md in Obsidian Source mode.
node bin/app.js claude agents update reviewer --from definitions/reviewer.md --if-match NATIVE_REVISION --dry-run
node bin/app.js claude agents update reviewer --from definitions/reviewer.md --if-match NATIVE_REVISION
```

Use the native agent's inspected revision for the update. Replacing an existing visible export instead requires that destination note's current revision with `export --if-match`. The two files have independent revision guards; exporting or editing a note does not automatically apply it to Claude.

## UTF-8 text

`.ts .tsx .mts .cts .js .jsx .mjs .cjs .json .jsonc .yaml .yml .toml .ini .css .scss .less .html .htm .xml .vue .svelte .txt .log .csv .tsv .sh .py .sql` files have kind `text`. `read` returns `{kind:"text",content}` with the exact decoded text, including any BOM and line endings. `list --kind text` selects them. `edit` appends or replaces exactly one literal match with the same revision guard as Markdown, and `write`/`create` replace or create them. `properties` stays Markdown-only and `patch` stays Canvas/Bases-only.

Classification uses the extension; the content decides the representation. Bytes that are not valid UTF-8 read as `{kind:"attachment",encoding:"base64",content}`, `validate` fails with `INVALID_ENCODING`, and `edit` refuses them, while `write` still stores the bytes losslessly. `validate` reports valid text as `validation:"utf8"`; it does not parse JSON, YAML or source syntax, so a `tsconfig.json` with comments is accepted. SVG remains an image.

## Canvas

The validator follows [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/): optional node/edge arrays; unique node IDs and edge IDs within their respective collections; text, file, link, and group nodes; integer geometry; valid colors, edge sides/ends, and existing edge endpoints. File-node subpaths must start with `#`, for example `#Heading` or `#^block-id`. This CLI additionally requires positive dimensions and nonempty IDs. Unknown extension fields are preserved. Referenced file existence and URL reachability are not checked. JSON formatting normalizes on pointer edits. A Canvas with currently missing edge targets must be repaired by a complete valid write.

## Bases

The structural contract follows [Obsidian Bases syntax](https://help.obsidian.md/bases/syntax). The file must be a mapping; views contain type/name; formula, property and summary sections are mappings; filter structures are checked. AST edits preserve YAML comments and unrelated keys. Plugin-added view types and extra view properties are retained. Ordinary validation checks structure; `bases query` separately evaluates a native file/view as a standalone repository using filters, formulas, sorting, grouping and file/link metadata. See the [Bases query contract and compatibility profile](bases.md). Structural validation cannot establish formula correctness or guarantee rendering in every Obsidian version; standalone queries do not load Obsidian community-plugin functions or render views.
