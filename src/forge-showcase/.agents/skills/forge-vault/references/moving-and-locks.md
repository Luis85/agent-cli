# Moving, deleting and the writer lock

Read this before restructuring notes, and when a write fails with `WORKSPACE_BUSY` or `ROLLBACK_FAILED`.

## Move and rename
- Always use the link-aware commands, never a copy plus delete.
- `move notes/plan.md specs/plan.md --dry-run`, or `rename notes/plan.md Roadmap --dry-run` (a file keeps its extension), returns `data.revision` and a `diff` for every file whose links change.
- Wikilinks and embeds keep `#Heading`, `#^block` and `|display` text; relative Markdown links are recomputed; frontmatter links and Canvas `file` nodes follow.
- Review `data.links.unrewritten`, then repeat without `--dry-run` and with `--if-match <revision>`. One batch commits the move and every rewritten file.
- A `<to>` that ends with `/` or names an existing folder moves the source into it under its own name. Moving a file with an extension to an extensionless name adds a warning.
- `DESTINATION_EXISTS`: Forge never overwrites the target.
- A folder moves the same way; its `--if-match` is the folder revision the dry run reports.
- A repeated move whose source is gone and whose destination holds the revision succeeds with `alreadyApplied: true`.

## Delete
- `delete notes/scratch.md --if-match <revision>` moves the file to `.trash/` (numbered ` 1`, ` 2`… when taken). A folder needs `--recursive`; `--permanent` removes instead of trashing.
- `HAS_BACKLINKS` lists the linking files in `details.backlinks`: rewrite or remove those links first, or move the note instead. Pass `--allow-broken-links` only when broken links are intended.
- `PROTECTED_PATH`: `.obsidian`, `.forge` and, at workspace scope, `bin` are protected in any letter case. `--permanent` also refuses folders with symlinks or `node_modules`: trash them instead.
- `data.deleted` lists every removed file and folder. A repeated delete fails with `NOT_FOUND`; `details.alreadyDeleted: true` and `details.trashPath` show where the first one put it.

## The writer lock
- All writers in a workspace share one lock, `.agent-cli.lock`, whatever their project.
- `WORKSPACE_BUSY` (exit 4): `details.lock` names the holder (pid, hostname, startedAt, command), `details.path` the lock file and `details.stale` is `active`, `unknown` or `stale`.
- `active` (`retryable: true`): wait `details.retryAfterMs` and retry, or rerun with the global `--wait <ms>`. Never delete an active lock.
- `unknown` (`retryable: false`): another host, container or boot, or an unreadable lock. Do not retry in a loop. Delete the file in `details.path` only after you verify the recorded process is not a running Forge writer and inspect its changes.
- `stale` (`retryable: false`): the holder no longer runs but Forge could not remove the file. Confirm no Forge process uses it, delete the file and retry.
- When Forge removes a stale lock itself, it adds a warning: inspect the interrupted changes with `git status` and read-back before continuing.
- `ROLLBACK_FAILED`: inspect every listed path and the saved contents before doing more work.
