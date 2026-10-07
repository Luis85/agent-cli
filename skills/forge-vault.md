---
name: forge-vault
description: Create and edit Obsidian Markdown, Canvas, Bases, and attachments with revision guards.
---

Run `node bin/app formats --json` for the format inventory. All paths are relative to `--root`, with `/` separators. Symlinks, traversal, and Git internals are rejected.

Inspect `config --json` for template/output paths. Use `templates inspect <template.md>` before `make document <Title> --template <template.md> --values-from <inputs.json> --dry-run`. Supply all non-built-in placeholders; use `--date <ISO>` for repeatable date/time output. Whole frontmatter placeholders preserve JSON value types. Templates cannot execute code.

- Markdown: `create notes/idea.md --content '# Idea'`. Read the revision, then use `properties notes/idea.md --set '{"status":"draft"}' --if-match <revision>`. Use `edit` for an exact single literal replacement or append. Wikilinks, embeds, callouts, math and code blocks remain text and are preserved. For an attachment embed append `![[assets/diagram.png]]` to a note.
- Canvas: `create planning.canvas`, then read its revision. Add a node with `patch planning.canvas --pointer /nodes/- --value '{"id":"idea","type":"text","x":0,"y":0,"width":320,"height":180,"text":"Idea"}' --if-match <revision>`. Edge endpoints must already exist. For a coordinated graph change, write a complete valid Canvas with its revision.
- Bases: `create tasks.base` produces a table view. Use JSON Pointer edits such as `/views/0/name`. Formulas and filters are stored as data; this CLI does not execute the Obsidian query engine.
- Attachments: `write assets/image.png --from incoming/image.png` copies bytes inside the root. Pipe external bytes to `write assets/image.png --stdin`, or use `--encoding base64`. Replacement requires the current revision. `read` returns attachment content as base64, with size and hash; decode it using a standard base64 decoder. No media/PDF transformation is implied.

Always preview edits with `--dry-run`, inspect `ok`, read back, and run `validate`. YAML structure is validated without executing formulas, HTML, scripts, or expressions. Unknown Canvas/Base keys are retained. A successful structural validation does not prove that an Obsidian formula or media codec works.
