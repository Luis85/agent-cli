# Read several files with one invocation

[Documentation](../index.md) · How-to

Use `read-many` to collect up to 32 files and their current revisions in one CLI
response. Paths are literal canonical POSIX paths relative to the active scope.
An explicit project applies only to this invocation and preserves saved selection:

```sh
node bin/forge.js read-many README.md src/main.ts --project the-forge
```

`data.files` follows the requested order. Each item has the same `path`, `revision`,
raw `bytes` and `document` representation as a default `read`: Markdown includes
content and properties, Canvas/Base include parsed data, text includes UTF-8
content, and attachments or invalid UTF-8 text include base64. Markdown's separate
`body` field is omitted. Optional `--parts` is available only on `read`.

`data.bytes` sums the raw byte counts and must not exceed 8 MiB (8,388,608 bytes).
Exactly 32 files and exactly 8 MiB are permitted. JSON escaping, parsed metadata
and base64 can make the serialized response larger. Files are read and inspected
whole, so this is an accepted-content limit, not a streaming or hard memory limit.
For larger requests, split the path list into smaller invocations or use `read`
for an individual file.

The entire path list is checked before reading. Duplicate canonical path strings
are refused; case-distinct names retain the same filesystem semantics as `read`.
Paths containing `./`, traversal, empty segments or backslashes are invalid
instead of being silently normalized. Symlink traversal remains forbidden.

A missing, unsafe or invalid document, or exceeding the byte limit, fails the
whole command. No partial `data.files` payload is returned. Per-file failures keep
the original error code and add `error.details.index` (zero-based position) and
`error.details.path`. Duplicate errors also identify `duplicateOf`. Limit and
argument-count violations use `INVALID_ARGUMENT`. The command stops at the first
read failure. Standard read events for preceding successful reads may already
have been delivered; no file writes or committed vault-change events occur.

Reads run sequentially. Each revision describes its own file at its read time;
this command does not promise one atomic snapshot across files. Review content
and use each returned revision with `--if-match` when making subsequent edits.
A changed file still produces a conflict under the normal guarded write contract.

Use `help read-many` and `schema read-many --json` for installed metadata, or
[the CLI reference](../reference/cli.md) for the response envelope and read formats.
