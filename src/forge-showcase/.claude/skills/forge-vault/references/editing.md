# Editing vault files

Read this for precise edits, apply plans, frontmatter, Canvas, Bases, text files, attachments and templates. Every mutation takes `--dry-run`; review `data.changes[].diff` (a unified diff, `null` for binary files). A stale `--if-match` fails with `CONFLICT` already in the preview. `node bin/forge.js formats` lists the supported formats.

## Precise edits
Each edit changes only what it addresses, in memory, with one guarded write.
- Section: `edit notes/plan.md --section "Plan > Risks" --append --content "- Staffing" --if-match <rev>`; also `--prepend --content` or `--replace <text>`. List headings outermost first, separated by ` > `; write a ` > ` inside a heading as ` \> `. The section runs to the next heading of the same or higher level.
- `SECTION_NOT_FOUND` lists `details.headings` or `details.blocks`. `AMBIGUOUS_SECTION` lists `details.candidates`: add an ancestor heading, or pass the candidate's `line` as `--section-line <n>` (`sectionLine` in a plan).
- Block: `edit notes/plan.md --block ship --replace "New text" --if-match <rev>` addresses `^ship` and keeps the marker. A list item keeps its indentation, marker, checkbox and nested items; start the text with a marker (`- [x] Done`) to change the checkbox. `--append` or `--prepend --content` add a separate block; next to a list item the content must start with a list marker, else `INVALID_INPUT`.
- Several literal replacements: `edit <file> --edits '[{"find":"a","replace":"b"},{"find":"x","replace":"y","all":true}]' --if-match <rev>`, or `--edits @edits.json` or `--edits -`. They apply in order; a failure names `details.edit` and writes nothing.
- `NO_MATCH` has `details.matches: 0`, `details.lineEndings` and possibly `details.nearMatch`. Reread and copy the exact text, including CRLF or LF line endings.
- `AMBIGUOUS_EDIT` counts every match in `details.matches`, lists `details.lines` and `details.snippets`. Extend `--find` with surrounding text.
- An edit that would change nothing reports `operation: "unchanged"` and writes nothing. `--content` holding a literal `\n` but no line break adds a warning: use `--stdin` for multiline text.

## Apply plans
- A plan is `{"version":1,"operations":[...]}` with `write`, `edit` (`edits`, `append`, or `section`/`block` with `replace`/`append`/`prepend`), `frontmatter` (`set`, `unset`), `move` (`from`, `to`) and `delete` (to `.trash`) operations.
- Every operation on a path that existed before the plan needs the `ifMatch` from your reads; a repeated plan then fails with `CONFLICT` instead of applying twice. Only paths the plan creates take none.
- Run `apply plan.json --dry-run`, then `apply plan.json` (or pipe the plan to `apply -`). Operations see earlier ones: edit a moved note by its new path. The plan commits as one batch or not at all.
- A failure keeps its code and adds `details.operation`; `INVALID_PLAN` lists `details.issues`. `schema apply` publishes the plan schema as the argument's `contentSchema`.
- Split a plan that writes to a path it also moves or deletes.

## Frontmatter
- `properties <note> --set '<json>' --unset a,b --if-match <rev>`. `null` in `--set` stores YAML `null`; `--unset` removes the key.
- Only touched entries are rewritten: untouched YAML keeps its bytes and comments, and new frontmatter is block style.
- Before setting a property, `vault properties --name <property>` shows its inferred and declared type, so values keep one type.

## Canvas and Bases
- Canvas: `create planning.canvas`, read its revision, then `patch planning.canvas --pointer /nodes/- --value '{"id":"idea","type":"text","x":0,"y":0,"width":320,"height":180,"text":"Idea"}' --if-match <rev>`. Edge endpoints must already exist. For a larger change, write a complete valid Canvas with its revision.
- Bases: `create tasks.base` makes a table view; edit it with pointers such as `/views/0/name`. `bases query tasks.base --view "Table"` returns the view's matching files without Obsidian. `bases capabilities` describes the evaluator's limits; a query that takes too long fails with `BASE_TIMEOUT`.
- Unknown Canvas and Base keys are kept. Structural validation does not run formulas.

## Text files and attachments
- Text files (`.ts`, `.json`, `.yaml`, `.css`, `.txt`, `.csv`, `Dockerfile` and others; see `formats` `textFilenames`) read as `document: {kind: "text", content}`. Edit them with `edit --find` or `--append`, or replace them with `write --stdin --if-match <rev>`.
- A file that is not valid UTF-8 or holds NUL characters reads as base64 and cannot be edited.
- Attachments: `write assets/image.png --from incoming/image.png` copies bytes inside the root; pipe outside bytes with `--stdin`, or pass `--encoding base64`. `read` returns attachments as base64 with size and hash.
- Embed an attachment in a note with `![[assets/diagram.png]]`.

## Templates
- `templates inspect <template.md>`, then `make document <Title> --template <template.md> --values-from <inputs.json> --dry-run`. Supply every non-built-in placeholder; `--date <ISO>` makes dates repeatable. Output defaults to `notes` in the active scope, or `--out`.
- Templates live in workspace `bin/templates` and cannot run code.
