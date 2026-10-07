---
name: forge-vault
description: Create and edit Obsidian Markdown, Canvas, Bases, and attachments with revision guards.
---

Run `node bin/app.js formats --json` for the format inventory. Run `project current` to confirm `data.project`, then verify `context.root` on file reads and mutations. File paths are relative to the active project, or the workspace when none is selected, with `/` separators. `--root` chooses the workspace; `project open <id>` persists a project selection and `project close` clears it. Symlinks, traversal, and Git internals are rejected.

Inspect `config --json` for the workspace and projects directory. Templates are shared in workspace `bin/templates`; document output defaults to active-scope `notes`, or use `--out`. Use `templates inspect <template.md>` before `make document <Title> --template <template.md> --values-from <inputs.json> --dry-run`. Supply all non-built-in placeholders; use `--date <ISO>` for repeatable date/time output. Whole frontmatter placeholders preserve JSON value types. Templates cannot execute code.

- Markdown: `create notes/idea.md --content '# Idea'`. Read the revision, then use `properties notes/idea.md --set '{"status":"draft"}' --if-match <revision>`. Use `edit` for an exact single literal replacement or append. Wikilinks, embeds, callouts, math and code blocks remain text and are preserved. For an attachment embed append `![[assets/diagram.png]]` to a note.
- Canvas: `create planning.canvas`, then read its revision. Add a node with `patch planning.canvas --pointer /nodes/- --value '{"id":"idea","type":"text","x":0,"y":0,"width":320,"height":180,"text":"Idea"}' --if-match <revision>`. Edge endpoints must already exist. For a coordinated graph change, write a complete valid Canvas with its revision.
- Bases: `create tasks.base` produces a table view. Use JSON Pointer edits such as `/views/0/name`. Run `bases query tasks.base --view "Table"` to return a saved view's matching files without Obsidian installed. Inspect `bases capabilities` for the standalone evaluator's compatibility profile; the native `.base` file and named view are the repository definition.
- Attachments: `write assets/image.png --from incoming/image.png` copies bytes inside the root. Pipe external bytes to `write assets/image.png --stdin`, or use `--encoding base64`. Replacement requires the current revision. `read` returns attachment content as base64, with size and hash; decode it using a standard base64 decoder. No media/PDF transformation is implied.

Always preview edits with `--dry-run`, inspect `ok`, read back, and run `validate`. YAML structure is validated without executing formulas, HTML, scripts, or expressions. Unknown Canvas/Base keys are retained. A successful structural validation does not prove that an Obsidian formula or media codec works.
