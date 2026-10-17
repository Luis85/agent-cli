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
`body` field is omitted. Optional `--parts` and `--lines` are available only on
`read`. Text and attachment content longer than `--max-bytes` (default 262,144
bytes) is truncated as `read` truncates it, with `truncated: true`, `lines` for
text and a warning per file.

`data.bytes` sums the raw byte counts. Each file counts toward an 8 MiB
(8,388,608 bytes) aggregate limit with its raw size up to `--max-bytes`, so with
the default limit 32 files always fit; with `--max-bytes 8388608`, exactly 8 MiB
of raw bytes are permitted. JSON escaping, parsed metadata and base64 can make the
serialized response larger. Each file is read whole and counts against the budget
before it is parsed, so the file that exceeds the budget fails the command without
being parsed. This is an
accepted-content limit, not a streaming or hard memory limit.
For larger requests, split the path list into smaller invocations or use `read`
for an individual file.

The entire path list is checked before reading. Duplicate canonical path strings
are refused; case-distinct names retain the same filesystem semantics as `read`.
Paths containing `./`, traversal, empty segments or backslashes are invalid
instead of being silently normalized. Symlink traversal remains forbidden.

A missing, unsafe or invalid document, or exceeding the byte limit, fails the
whole command. No partial `data.files` payload is returned. Per-file failures keep
the original error code and add `error.details.index` (the zero-based position of
the path argument) and `error.details.path`; the message names the same index, as
in `read-many path at index 1: ...`. Duplicate errors also identify `duplicateOf`. Limit and
argument-count violations use `INVALID_ARGUMENT`. The command stops at the first
read failure. Standard read events for preceding successful reads may already
have been delivered; no file writes or committed vault-change events occur.

Reads run sequentially. Each revision describes its own file at its read time;
this command does not promise one atomic snapshot across files. Review content
and use each returned revision with `--if-match` when making subsequent edits.
A changed file still produces a conflict under the normal guarded write contract.

Use `help read-many` and `schema read-many --json` for installed metadata, or
[the CLI reference](../reference/cli.md) for the response envelope and read formats.
