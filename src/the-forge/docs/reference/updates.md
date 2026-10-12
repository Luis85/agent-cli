# App updates

[Documentation](../index.md) · Reference

The bundled `updates` core plugin lets an installed app check and upgrade itself from stable releases of [Luis85/agent-cli](https://github.com/Luis85/agent-cli/releases). It is enabled by default. Updates need Node, curl and tar, but no npm install or repository source.

| Command | Behavior |
| --- | --- |
| `update check [--release-version <version>]` | Read installed version and `bin/` folder revision. Without a pinned version, resolve GitHub's latest stable release. No app changes |
| `update apply --release-version <version> --if-match <revision> [--dry-run]` | Download and verify the pinned archive, preview or apply its owned assets as one guarded batch |

## Agent upgrade workflow

```sh
node bin/forge.js update check --json
# Use data.releaseVersion and data.revision from that result.
node bin/forge.js update apply --release-version 0.1.0 --if-match <revision> --dry-run --json
node bin/forge.js update apply --release-version 0.1.0 --if-match <revision> --json
node bin/forge.js --version
node bin/forge.js project current --json
```

These commands always target workspace scope, regardless of the selected project. With `--root`, they update that workspace's own `bin/`; they never silently update the calling distribution elsewhere. Discovery does not activate user plugins. `update check` returns `installedVersion`, `releaseVersion`, `available`, `revision` and `releaseUrl`. An explicit `--release-version` checks local installation against that version without querying latest; apply downloads and verifies the requested release. Only stable `x.y.z` versions are supported. Downgrades are refused.

The agent checks the exit status and JSON `ok`, reviews dry-run `changes`, then applies the same version with the same revision. If anything in `bin/` changes after inspection or during download, `CONFLICT` prevents all planned writes; recheck and review the new state. A dry run may download and unpack into temporary storage but writes no workspace files and emits no committed vault events.

## Preservation and integrity

The archive SHA-256 must match its release checksum. Archive paths, regular file types, package and executable versions, required assets and distribution ownership are validated before writes. Only files declared in the old or new distribution manifest can change. Mutable files are never valid distribution entries.

The update preserves `bin/config.json`, `bin/data/context.json`, other private data, installed plugins, editable templates, custom published webviews and all project files. It refreshes the CLI and server bundles, defaults, bundled admin view, browser runtime, SDK, documentation, licenses and bundled skill sources. Obsolete owned assets are removed. Installed project copies of agent skills remain user files and are not replaced.

Apply returns `checksum`, `changed`, `dryRun`, `changes`, the current folder `revision`, and `restartRequired`. The next CLI invocation loads the new app. A running server still uses its loaded runtime: when `restartRequired` is true, run `server stop` followed by `server start --webview admin` (or the previously selected view) to load the new server and assets.

Writes use the workspace lock, optimistic revision guards, preflight validation and rollback on reported errors. Like other Forge batch writes, this does not promise crash atomicity or prevent an external reader from observing files mid-commit. The existing Node invocation continues from memory while its installed files are updated. A same-version repeat with the current revision makes no changes when files already match; a stale revision is refused.

`UPDATE_DOWNLOAD_FAILED` reports sanitized download/tool failures; check network access, curl, tar and disk space. `UPDATE_INVALID` reports invalid versions, checksum or asset contracts; app files remain unchanged when validation fails. `UPDATE_SCOPE_INVALID` means the target lacks an installed Forge distribution. A checksum detects corruption; releases and their checksums must come from a trusted source.
