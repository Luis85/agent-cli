# Vault checks

[Documentation](../index.md) · Reference

`vault` verifies the vault of the command scope (the selected project, or the workspace when none is selected) and inventories its tags and properties. It reads the kernel [metadata index](formats.md#metadata-index), never writes and publishes no events. It is contributed by the `vault-check` [core plugin](plugins.md#core-and-user-plugins) (`src/plugins/vault-check/` in the Forge source), enabled by default; `plugins.disabled: ["vault-check"]` removes the command.

```sh
node bin/forge.js vault check
node bin/forge.js vault check --strict
node bin/forge.js vault check --path "notes/**" --rule unresolved-link,unresolved-embed
node bin/forge.js vault tags --sort count
node bin/forge.js vault properties --name status
```

The plugin id is `vault-check`, not `vault`: `vault` is the host's Obsidian event namespace (`vault.create`, `vault.modify`, `vault.delete`, `vault.rename`), which no plugin may own ([event ownership](plugins.md#event-ownership)). The command keeps the bare id `vault`, as core plugins may. Inventories are actions of `vault` because the kernel `properties` command already sets frontmatter properties.

## Command contract

| Action | Result |
| --- | --- |
| `vault check [--path glob] [--rule id[,id…]] [--strict]` (the default action) | `{findings, summary, rules, skipped, strict}`: every finding of the enabled rules, sorted by path, line, column, rule order and message |
| `vault tags [--path glob] [--sort name\|count]` | `{tags}`: `[{tag, count, files}]` for frontmatter and inline tags |
| `vault properties [--path glob] [--name property]` | `{properties, typesFile}`: `[{name, count, empty, types, type, declared, conflicting, files?}]` |

`--path` takes a [path glob](cli.md#path-globs-and-paging) and selects the files that are checked or inventoried. `--rule` takes comma-separated rule ids; an unknown id, an unknown action, an extra argument or an invalid `--sort` fails with `INVALID_ARGUMENT`. Without `--strict` findings never fail the command. With `--strict`, a check that holds at least one finding of severity `error` fails with [`VAULT_CHECK_FAILED`](errors.md#core-plugin-codes) (exit 2): `error.details` carries `summary`, `rules`, the first 100 error findings in `findings` and `truncated`. Warnings and info findings never fail a strict check.

A finding is:

```json
{
  "rule": "unresolved-link", "severity": "error", "path": "Draft.md", "line": 1, "column": 5,
  "message": "Link [[Projects/Alpah]] does not resolve to a file.",
  "hint": "Create the target note, correct the link path, or remove the link. Closest existing file: Projects/Alpha.md.",
  "suggestion": "Projects/Alpha.md"
}
```

| Field | Meaning |
| --- | --- |
| `rule`, `severity` | The rule id and its effective severity: `error`, `warning` or `info` |
| `path` | The root-relative file the finding belongs to (`.obsidian/types.json` for an invalid type registry) |
| `line`, `column` | 1-based position of the reference, frontmatter property, block or YAML error; columns count UTF-16 code units. `null` for file-level findings, Canvas nodes and Bases |
| `message`, `hint` | What is wrong and the next step, in the response language (`--lang de` answers in German) |
| `suggestion` | For `unresolved-link` and `unresolved-embed`: the vault path whose file name is closest to the missing target (edit distance up to a third of the name, ignoring case and `.md`), when one exists |

`summary` is `{files, findings, error, warning, info}`: the number of files checked and findings per severity. `rules` lists the rules that ran as `{id, severity, findings}`. `skipped` lists selected rules that did not run as `{rule, reason, message}`: `reason` is `off` (turned off in the settings) or `unavailable` (`invalid-base` without the `bases` plugin).

## Rules

| Rule | Default | Reports |
| --- | --- | --- |
| `unresolved-link` | `error` | A wikilink, Markdown, reference or HTML link, or a frontmatter link, whose target file does not exist, with the closest file name as `suggestion` |
| `unresolved-embed` | `error` | An embed (`![[…]]`, a Markdown image or a frontmatter `"![[…]]"`) or a Canvas `file` node whose file does not exist, with a `suggestion` |
| `ambiguous-link` | `warning` | A link path or alias that matches several files equally well; the message lists the candidates. Obsidian opens the closest candidate, Forge does not guess |
| `unresolved-anchor` | `warning` | A resolved link to a Markdown note whose `#Heading`, `#Parent#Child` or `#^block` subpath the note does not contain. Headings compare by letters and digits ignoring case, so `[[Note#My heading]]`, `note.md#My%20heading` and the GitHub slug `note.md#my-heading` all name `## My Heading`; a `-1` suffix names a repeated heading |
| `invalid-frontmatter` | `error` | A Markdown note the index cannot parse: invalid YAML frontmatter (`INVALID_YAML`, positioned at the YAML error), a frontmatter that is not a mapping or an unclosed block (`INVALID_FRONTMATTER`), or invalid UTF-8. Its links, tags and properties are missing from every report until it is fixed |
| `invalid-canvas` | `error` | A Canvas file that is not valid [JSON Canvas 1.0](formats.md): invalid JSON, duplicate or missing ids, unknown node types, invalid geometry or colours, or an edge whose `fromNode` or `toNode` names a missing node (the message names the edge and node) |
| `invalid-base` | `error` | A `.base` file that `bases query` would reject before evaluating it: invalid structure or YAML, duplicate view names, formulas or filters that do not compile, circular formulas, and invalid `sort`, `groupBy` or `groupOrder` entries. One finding per problem; `view` problems name the view. Uses the `bases.validation` service of the [`bases` plugin](bases.md) and is skipped when that plugin is disabled |
| `property-type-mismatch` | `warning` | A frontmatter value whose type differs from the property's type: the type `.obsidian/types.json` declares, or else the type most notes use for that name (ties go to the type seen first in path order). Also one finding on `.obsidian/types.json` when it is not valid JSON or has no `types` mapping; it then declares nothing |
| `duplicate-block-id` | `warning` | A `^block` id used again in the same note (ignoring case); links reach only the first block. The finding names the line of the first use |
| `empty-file` | `warning` | A Markdown note with neither frontmatter nor content (whitespace and `%%comments%%` only), or any other file of zero bytes. A note with only properties is not empty |
| `orphan-attachment` | `info` | An attachment (image, audio, video, PDF or another file that is neither a note, Canvas, Base nor UTF-8 text) that no file links to, embeds, names in a property or places on a Canvas |

External URLs are never findings. Links in code blocks and `%%comments%%` are not links, as in Obsidian.

## Property types

Types follow Obsidian's Properties view: `text`, `list`, `number`, `checkbox`, `date` (`YYYY-MM-DD`) and `datetime` (`YYYY-MM-DDTHH:mm`, optional seconds and offset), plus `object` for a nested mapping, which the Properties view does not support. An empty value (`key:` or `key: ""`) fits every type. Like Obsidian, a property name has one type across the vault, so `property-type-mismatch` infers types over every note outside the ignore globs, whatever `--path` selects, and reports only notes inside `--path`. `vault properties` infers them over the selected notes.

`.obsidian/types.json` at the scope root is read when present (`{"types": {"status": "text"}}`), although the configuration folder is otherwise excluded from the vault. Its type names map as follows; a value fits when its inferred type is accepted:

| Declared | Accepts |
| --- | --- |
| `text` | `text`, `date`, `datetime` |
| `multitext` | `list` |
| `tags`, `aliases` | `list`, `text` |
| `number` | `number` |
| `checkbox` | `checkbox` |
| `date` | `date` |
| `datetime` | `datetime`, `date` |

Other type names, such as those of community plugins, accept every value. Obsidian does not document this file; Forge relies on its observed format, as [Bases](bases.md) does.

## Tags and properties

`vault tags` lists tags from frontmatter `tags` and inline `#tags` of the selected Markdown notes, like Obsidian's tag pane: a nested tag also counts for each parent, so `#area/work` adds the file to `#area`. Tags compare without case and keep the spelling seen first in path order. `count` is the number of files in `files`. `--sort name` (the default) orders by tag ignoring case; `--sort count` puts the most used tags first, then by name.

`vault properties` lists every top-level frontmatter property of the selected notes, sorted by name ignoring case. `count` is the number of notes that set it, `empty` how many of those leave it empty, `types` the number of values per inferred type, `type` the most frequent type (or `null` when every value is empty), `declared` the type name in `.obsidian/types.json` (or `null`) and `conflicting` whether any value conflicts with the declared type or, without one, with `type`. `--name` keeps one property (an exact name) and adds `files`, each note's `{path, type}`. `typesFile` is `{path: ".obsidian/types.json", status}` with `status` `missing`, `loaded` or `invalid`.

## Settings

`plugins.settings.vault-check` in `bin/config.json`:

```json
{
  "plugins": {
    "settings": {
      "vault-check": {
        "rules": { "orphan-attachment": "off", "unresolved-anchor": "error" },
        "ignore": ["templates/**", "archive/**"]
      }
    }
  }
}
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `rules` | `{}` | Severity per rule id: `error`, `warning`, `info` or `off`. Unset rules keep the default above. An `off` rule never runs, even when `--rule` names it; it is listed in `skipped` |
| `ignore` | `[]` | Path globs of files that `vault check`, `vault tags` and `vault properties` skip. Ignored files produce no findings and do not count towards inferred property types, but stay link targets, so links into them resolve |

An unknown rule id, an unknown severity, an empty string or a malformed glob, such as the reversed class `[z-a]`, makes the plugin unavailable when the configuration loads: every response warns, and `vault` fails with `PLUGIN_UNAVAILABLE`, naming the problem in `error.details.issues`.

## Limits

- Checks read the files as they are on disk in one invocation; they are a snapshot, not a watcher.
- Heading anchors are matched by normalized text; Obsidian's own matching of punctuation in headings is undocumented.
- `ambiguous-link` reports what Obsidian resolves silently. Rename one candidate or use a longer link path.
- Folder links such as `[tests](tests/)` are `unresolved-link` findings: Obsidian links files, not folders. Exclude navigation pages written for code hosts with `ignore` or check only the note folders with `--path`.
