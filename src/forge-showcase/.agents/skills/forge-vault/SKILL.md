---
name: forge-vault
description: Read, search, link-check, create and edit Obsidian Markdown notes, frontmatter properties, Canvas, Bases and attachments through Forge with revision guards, link-preserving moves and trash deletes. Use when working with notes, wikilinks, backlinks, tags, .canvas or .base files, or any vault file edit in a Forge workspace.
license: MIT
compatibility: Requires Node.js 22.12 or newer and The Forge distribution in the workspace bin folder.
metadata:
  author: The Forge
  version: "0.1.0"
---

Edit vault files only through Forge, so links, frontmatter and revisions stay intact. Root rules, the read → `--dry-run` → `--if-match` loop and retries are in the `forge-workflow` skill.

## Paths
- Paths are relative to `context.root`: the open project, or the workspace. `--project <id>` targets another project for one call.
- `./x`, `x\y` and absolute paths inside the root are accepted. Traversal, symlinks and `.git` fail with `INVALID_PATH`.

## Read and find
- `read <path>` returns `revision`; a note also returns `content` and `properties` (`--parts body` for the body only).
- Content over 256 KiB is cut (`truncated: true`, `lines.total`): continue with `--lines <a>-<b>`. A note with broken frontmatter still reads, with `properties: null` and an `issue`.
- `search "text"` returns hits with `path`, `line` and `revision`. Narrow with `--path notes`, `--tag`, `--property status=active`, `--regex`, `--files-only` or `--count`.
- `list --path notes --kind markdown` lists files. Page both with `--cursor <nextCursor>`.
- `read-many <paths…>` reads up to 32 files; `stat <path>` gives a revision without content.
- `links back <note>` lists notes that link to it; `links unresolved` lists broken links.

## Change
- New file: `create notes/idea.md --content '# Idea'`; existing files are refused.
- One replacement: `edit <file> --find <old> --replace <new> --if-match <rev>`. Several: `--edits '[{"find":"a","replace":"b"}]'`.
- Part of a note: `--section "Plan > Risks" --append --content "- Item"` or `--block <id> --replace <text>` instead of `--find`.
- Frontmatter: `properties <note> --set '{"status":"draft"}' --unset old --if-match <rev>`. Untouched YAML keeps its bytes.
- Whole file: `write <path> --stdin --if-match <rev>`. Canvas or Base JSON: `patch <file> --pointer /nodes/- --value '<json>' --if-match <rev>`.
- Several files: one `apply plan.json`, with `--dry-run` first and `ifMatch` on every existing path.
- Move or rename: `move <from> <to>` rewrites every link. A `<to>` ending in `/` or naming a folder moves into it.
- Delete: `delete <path>` moves the file to `.trash/`. Never copy and delete to move.
- Dry-run `move`, `rename` and `delete` first: the preview reports the `revision` for `--if-match`.

## Verify
- Read the file back and run `validate <path>`.
- Run `vault check --strict` and fix each finding by its `hint` until it passes.

## Errors
- `NO_MATCH`: copy the exact current text, including whitespace and line endings.
- `AMBIGUOUS_EDIT`: extend `--find` until it matches once (`details.lines`).
- `SECTION_NOT_FOUND`: pick from `details.headings` or `details.blocks`.
- `AMBIGUOUS_SECTION`: pass a `details.candidates` line as `--section-line`.
- `CONFLICT`: reread and reapply your change to the current content.
- `DESTINATION_EXISTS`: Forge never overwrites; choose another target.
- `HAS_BACKLINKS`: fix the links in `details.backlinks` first, or move the note instead.
- `PROTECTED_PATH`: `.obsidian`, `.forge` and workspace `bin` cannot move or be deleted.

## Reference
- [Editing](references/editing.md): sections, blocks, apply plans, properties, Canvas, Bases, text, attachments and templates.
- [Finding and checking](references/finding.md): read limits, search, list, links and vault check rules.
- [Moving, deleting and locks](references/moving-and-locks.md): link rewriting, the trash and `WORKSPACE_BUSY` recovery.
- Screenshots in notes: the `forge-browser` skill.
