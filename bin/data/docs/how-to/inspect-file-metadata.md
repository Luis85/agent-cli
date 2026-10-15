# Inspect file and folder metadata

[Documentation](../index.md) · How-to

Use `stat <path>` when you need a revision for a guard or a compact size/count summary without returning the content. The command uses the same repository revisions as file writes and folder moves. It does not parse or validate Markdown, Canvas, Bases or text, so malformed documents and binary files can still be inspected.

```sh
node bin/forge.js stat notes/plan.md --json
node bin/forge.js stat notes --json
node bin/forge.js stat assets/image.png --project alpha --json
```

A file returns `{path, kind: "file", revision, bytes}`, where `bytes` is the raw size. A folder returns `{path, kind: "folder", revision, fileCount, folderCount}`. The response never includes document content, base64, or lists of descendant paths. Use `read` for document content, `list` for file discovery, and `validate` for supported structural checks.

Folder counts cover regular descendant files and folders, including empty subfolders but excluding the inspected folder itself. Git internals and Forge lock/temporary entries are skipped. Symlinks and `node_modules` folders are not traversed or counted. The existing folder revision also fingerprints these special entries by path and kind, including a symlink's target. Changes to excluded dependency contents do not change that revision. Direct paths through symlinks, traversal and reserved paths remain rejected.

A revision is a content fingerprint, not a reservation or proof that a document is valid. Files are read and hashed whole; folders are walked recursively. Compact output does not make this a cheap filesystem stat or a hard memory limit. Concurrent external edits can change a file or tree during or after inspection. The final mutation must retain its revision guard.

For a folder move, obtain its revision with `stat notes`, preview `move notes archive --if-match <revision> --dry-run`, then apply the same move without `--dry-run`. A stale revision fails with `CONFLICT`. For malformed frontmatter, `stat` supplies the current revision even when `read` fails; inspect the original bytes separately, prepare the intended repair, then preview and apply a guarded `write`. Metadata alone does not provide enough content to safely reconstruct a document.

Paths resolve within the saved project, or within the workspace when no project is selected. `stat --project <id>` chooses a managed project for that invocation and leaves saved selection unchanged. Invalid or missing targets fail without fallback; a valid explicit target works even when saved selection is stale. Later mutations must use the same project scope: `stat` does not retarget subsequent commands, and other commands accept `--project` only when their own help declares it. Verify `context.root` and `context.project`; identical bytes in different projects have identical revisions.

See [moving and deleting](../reference/cli.md#moving-and-deleting) for guards and protected paths. `stat` performs no document mutations and emits no committed vault-change events. `help stat` and `schema stat --json` expose the installed contract.
