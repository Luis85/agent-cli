# Distribution, operations and platform

[Research index](README.md) · Researched 2026-10-10

## Summary

- **Ship through npm first, and keep the vendored `bin/` model.** The Forge already has a zero-runtime-dependency bundle (`bin/app.js`, 1.7 MB, 383 KB gzipped). Publish it to npm with OIDC trusted publishing, then use `npx @luis85/forge@<version> setup|upgrade` to install or refresh a workspace's committed `bin/`. Native binaries can wait.
- **The largest operational risk is Bases scaling.** In local measurements, `bases query` took 2.8 s for 250 notes, 9.0 s for 1,000 and 142 s for 5,000. Evaluation contexts are rebuilt for every row, making the query O(n²).
- **Upgrades have no safe path.** Config is pinned to `schemaVersion: z.literal(1)`. No migration mechanism or upgrade command exists, and plugin compatibility only has a lower bound (`minAppVersion`). A 1.0 needs a dry-run-first `upgrade` command and `config migrate`.
- **Cross-platform support is unverified.** CI covers Ubuntu only. `.gitattributes` has no end-of-line policy, file writes don't retry Windows `EPERM`/`EBUSY` errors, and the lock file carries no owner metadata. GitHub provides Windows and macOS (x64 and arm64) runners free for public repositories.
- **Startup is acceptable and easy to improve.** Cold `--version` takes about 210–230 ms against 37 ms for bare Node. Enabling Node's compile cache brought it to about 143 ms. `module.enableCompileCache()` is available on the 22.12 floor.
- **The Node support window is narrowing.** Node 22 reaches end of life on 2027-04-30, and Node 26 becomes LTS on 2026-10-28. The CI matrix should add Node 26, and the floor should be revisited at 1.0.
- **Long-running modes should be MCP stdio first.** The envelope and no-stdout-logging design already match MCP's stdio rules; a watcher or daemon only pays off after a persistent index exists.
- **No remote telemetry.** For observability, export the existing event bus as local JSONL or OpenTelemetry traces instead. If remote telemetry is ever added, make it opt-in and honour `DO_NOT_TRACK=1`, as Turborepo does.

## Method

- **Repository reading.** I read `docs/how-to/release.md`, `docs/reference/configuration.md`, `docs/reference/plugins.md`, `.github/workflows/check.yml`, `bin/package.json`, `bin/data/distribution.json`, the getting-started tutorial, and the relevant source: the workspace file adapter, config schema, plugin registry and Bases engine.
- **Read-only measurements** (Linux, Node 22.22.0, no repository mutation): startup timing with and without `NODE_COMPILE_CACHE`, `maxRSS`, `list` and `bases query` against synthetic 250–5,000-note vaults in the session scratchpad (via `--root`), and a `--cpu-prof` profile at 500 notes. Timings come from one shared container and are indicative only.
- **Web research:** fetched primary documentation listed under Sources. Claims seen only in search-result summaries are marked *(search summary)*.

## Findings

### How agent and developer CLIs ship in 2025–2026

- **Agent CLIs have moved to native binaries with several channels.** Claude Code offers an auto-updating native installer, Homebrew casks (`stable`, about a week behind, and `latest`), WinGet, signed apt/dnf/apk repositories, and an npm package that installs a per-platform binary. It supports `minimumVersion` pins and `DISABLE_UPDATES`, and ships GPG-signed manifests plus notarized/Authenticode-signed binaries ([Claude Code setup](https://code.claude.com/docs/en/setup)).
- **Codex follows the same pattern.** It ships install scripts, `npm i -g @openai/codex`, a Homebrew cask and GitHub Release binaries ([openai/codex](https://github.com/openai/codex)).
- **Gemini CLI stays npm-first** with `latest`/`preview`/`nightly` dist-tags *(search summary; [Gemini CLI installation](https://www.geminicli.com/docs/get-started/installation))*.
- **Release channels plus explicit pinning are the norm;** package-manager installs deliberately do not auto-update.
- **npm trusted publishing is GA and removes long-lived tokens.** It became generally available on 2025-07-31 ([GitHub changelog](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)). Publishing from GitHub Actions uses OIDC and emits provenance by default (requires npm CLI ≥ 11.5.1; not available from private repositories).
- **GitHub artifact attestations cover non-npm assets.** `actions/attest` (needs `id-token: write` and `attestations: write`) attests release files, and consumers check them with `gh attestation verify` ([GitHub docs](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds)).
- **Node SEA is still Stability 1.1 ("Active development").** `--build-sea` exists only since v25.5.0, the asset VFS is "Early development", macOS needs at least ad-hoc `codesign`, and code cache/snapshots are platform-specific ([Node SEA docs](https://nodejs.org/api/single-executable-applications.html)).
- **Bun and Deno cross-compile to Linux, macOS and Windows (x64/arm64) with embedded assets** ([Bun executables](https://bun.com/docs/bundler/executables), [Deno compile](https://docs.deno.com/runtime/reference/cli/compile/)), but replace Node, which matters for trusted Node plugins.
- **Workspace version pinning has consolidated on mise.** Volta's README says "Volta is unmaintained" and recommends mise ([volta-cli/volta](https://github.com/volta-cli/volta)). mise pins npm CLIs per project with a lockfile ([mise npm](https://mise.jdx.dev/dev-tools/backends/npm.html)) and installs GitHub Release assets with checksum and attestation verification ([mise github](https://mise.jdx.dev/dev-tools/backends/github.html)). npm's `devEngines` declares runtime and package-manager requirements with `onFail` ([npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#devengines)).
- **Configuration migration as a command is established practice.** `biome migrate` previews the configuration changes needed after an upgrade and only writes with `--write` ([Biome CLI](https://biomejs.dev/reference/cli/)). This matches The Forge's dry-run-first contract.

### Node runtime timeline and performance levers

- **Node 26 is the next target.** Node 22 reaches end of life on 2027-04-30. Node 24 enters maintenance on 2026-10-20, and Node 26 becomes Active LTS on 2026-10-28 ([nodejs/Release](https://github.com/nodejs/Release)). From Node 27 there will be one major release per year ([Node previous releases](https://nodejs.org/en/about/previous-releases)).
- **The compile cache is available on the current floor.** `module.enableCompileCache()` was added in v22.8.0 and is no longer experimental from v25.4.0. It never throws, and users can override it with `NODE_COMPILE_CACHE` or disable it with `NODE_DISABLE_COMPILE_CACHE=1` ([Node module docs](https://nodejs.org/api/module.html#module-compile-cache)).
- **Startup snapshots are now stable but restrictive.** `--build-snapshot` is no longer experimental from v24.13.1/v25.4.0. It needs a single bundled entry, and only some built-ins are serializable ([Node CLI docs](https://nodejs.org/api/cli.html#--build-snapshot-entry)).
- **`node:sqlite` is close to stable.** It was unflagged in v22.13.0, one patch above The Forge's 22.12 floor, and has been a release candidate (1.2) since v25.7.0 ([Node sqlite docs](https://nodejs.org/api/sqlite.html)).
- **The permission model is a seat belt, not a sandbox.** It has been stable since v22.13.0, but the docs say it "does not protect against malicious code" ([Node permissions](https://nodejs.org/api/permissions.html)). It is therefore no sandbox for plugins.

### Long-running modes and file watching

- **MCP stdio fits the existing design.** The server must not write anything but MCP messages to stdout, messages are newline-delimited, and logging may go to stderr ([MCP transports 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)).
- **The MCP Registry is still in preview.** It verifies namespaces through GitHub OAuth/OIDC or DNS ([modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry)).
- **Watcher options:**
  - chokidar v4 dropped globs and fsevents and went from 13 dependencies to 1. v5 is ESM-only and needs Node 20+ ([chokidar](https://github.com/paulmillr/chokidar)).
  - `@parcel/watcher` uses native backends (FSEvents, inotify, ReadDirectoryChangesW). It offers `writeSnapshot`/`getEventsSince` for changes made while no process was running, and VS Code and Nx use it ([parcel-bundler/watcher](https://github.com/parcel-bundler/watcher)).

### Plugin ecosystems

- **Obsidian:** the registry is a reviewed `community-plugins.json` list, and assets come from GitHub releases tagged with the manifest version ([obsidian-releases](https://github.com/obsidianmd/obsidian-releases)). Older apps fall back to a compatible plugin release through `versions.json`, which maps each plugin version to its `minAppVersion` ([Obsidian versions](https://docs.obsidian.md/Reference/Versions)).
- **ESLint and Vite:** npm naming/keyword conventions; ESLint adds `meta {name, version, namespace}` and an `eslint` peer dependency ([ESLint plugins](https://eslint.org/docs/latest/extend/plugins), [Vite plugin API](https://vite.dev/guide/api-plugin)).
- **oclif:** user-installed plugins via `@oclif/plugin-plugins` ([oclif plugins](https://oclif.io/docs/plugins)).
- **Commander (The Forge's choice):** it has no plugin system, only stand-alone executable subcommands and `.addCommand()`. It requires Node ≥ 22.12.0 ([commander.js](https://github.com/tj/commander.js)). That matches the Forge floor and is why the Forge's own registry exists.

### Cross-platform and observability

- **CI:** standard GitHub-hosted Windows x64/arm64 and macOS Intel/arm64 runners are free for public repositories ([GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)).
- **Line endings:** `* text=auto` with `eol=lf` normalizes line endings, and `binary` disables conversion ([gitattributes](https://git-scm.com/docs/gitattributes)).
- **Windows rename failures:** graceful-fs retries a rename for up to about one second on `EACCES`/`EPERM`, which it attributes to antivirus locks *(search summary; [node-graceful-fs](https://github.com/isaacs/node-graceful-fs))*.
- **Telemetry norms:**
  - Turborepo anonymizes its data and documents an opt-out through `turbo telemetry disable`, `TURBO_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`, with a debug mode that shows the payload ([Turborepo telemetry](https://turborepo.dev/docs/telemetry)).
  - The historical `DO_NOT_TRACK` proposal site, consoledonottrack.com, now serves unrelated content. Cite tool documentation instead.
  - The OpenTelemetry GenAI conventions (agent and MCP spans) moved to [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai) and are still in Development status *(status per search summaries)*.

## Assessment of The Forge

### Measured

| Probe | Result |
| --- | --- |
| Bundle | `bin/app.js` 1,738,423 B (382,835 B gzip); whole `bin/` 2.7 MB; CommonJS, no `require` of node_modules at runtime |
| Cold start | bare `node -e ""` 37 ms; `--version` 210–230 ms; `schema --json` 170–220 ms; `project current` 205–235 ms |
| With compile cache | `--version` about 143 ms (about 35% faster) |
| Memory | `schema --json` maxRSS about 71 MB |
| `list` over 5,000 notes | about 230 ms; 400 KB pretty JSON, no pagination |
| `bases query --limit 5` | 250 notes 2.8 s; 500 notes 3.3 s; 1,000 notes 9.0 s; 5,000 notes 142 s |
| Bases profile (500 notes) | `createEvaluationContext`, `createFileContext` and `addFileResolution` dominate self time |

The cause of the Bases result is in `src/the-forge/infrastructure/bases/engine.ts:89`. It calls `createEvaluationContext({ …, files: indexed, … })` once per candidate row. The bundled `obsidian-bases-expression` then maps every file to a new context and rebuilds the link-resolution map each time, which is O(n²). `infrastructure/bases/links.ts` adds cost by scanning and lowercasing every path per link, and `indexBaseFiles` reads and stats files sequentially.

### Strengths

- **Self-contained runtime** with bundled license notices: an npm package or SEA blob is straightforward.
- **Verifiable releases.** Archives are reproducible and come with SHA-256 checksums. CI rejects drift in the committed bundle, and `bin/data/distribution.json` lists the shipped files.
- **Inherent version pinning.** Committing `bin/` pins the tool version to the repository commit, much as `packageManager` or `.nvmrc` would. It also works offline.
- **Careful writes.** Writes go through a temp file and `rename`. Revision guards, BOM and newline-style preservation, and path containment are already in place.
- **Agent-ready protocol.** The machine-readable catalog (`schema --json`), the envelope with stable exit codes, and stdout discipline are most of an MCP adapter already.
- **Typed plugin contract.** Plugins get a type-only SDK, atomic registration, a `minAppVersion` check and `--no-plugins` recovery.

### Gaps

- **Distribution:** `"private": true`; no npm publish, signing or attestations. Upgrades mean manual extraction and file preservation; releasing requires GNU tar; the "copy `bin/` then reset config" path is error-prone; monorepos have no way to pin one version across workspaces.
- **Upgrades:** `schemaVersion` is a Zod literal, so the first schema change breaks old configs, and an older binary rejects a newer config (unknown keys) with no hint. No `upgrade` or `doctor` command.
- **Plugins:** lower-bound compatibility only (no API range or `versions.json`-style fallback); no install, discovery or integrity record; the incompatibility message still says "agent-cli"; the app reports `apiVersion: 1` but manifests cannot declare one.
- **Cross-platform.**
  - CI runs on Ubuntu only.
  - No `eol` attributes exist, so a Windows checkout with `core.autocrlf` changes bytes. That alters SHA-256 revisions and can trip the CI `git diff -- bin` check.
  - No `EPERM`/`EBUSY` retry exists around `rename`.
  - The `wx` lock file has no PID, host or timestamp, so stale-lock recovery is manual.
  - I found no case-collision check (`Note.md` vs `note.md`) in the file adapter, although `links.ts` matches case-insensitively.
- **Scale and operations:** quadratic Bases; no `list` paging; no cache between invocations; no compile cache; no local trace export of the ephemeral event bus.

## Recommendations

| ID | Recommendation | Priority | Effort | Rationale and evidence |
| --- | --- | --- | --- | --- |
| DP-1 | Make Bases linear. Build file contexts and the link-resolution map once per query and pass a prebuilt context to each row; push a fix upstream or wrap `obsidian-bases-expression`. Replace per-link path scans with Maps keyed by exact path, lowercased path and basename. Read and stat files with bounded concurrency. Add a 5,000-note performance test with a time budget. | P0 | M | 142 s at 5,000 notes, with the hotspot at `engine.ts:89`. |
| DP-2 | Publish the existing bundle to npm as `@luis85/forge`: drop `private`, ship only `bin/` assets, use trusted publishing with OIDC provenance, and use `latest`/`next` dist-tags. Document `npx @luis85/forge@x.y.z setup` as the way to install into a workspace. | P0 | M | Zero runtime dependencies make the package trivial, and OIDC is GA ([GitHub changelog](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)). This keeps the committed-`bin` pinning model. |
| DP-3 | Automate GitHub Releases on tag: tar.gz plus zip (Windows users), `SHA256SUMS`, and `actions/attest` provenance. Document `gh attestation verify`. Remove the GNU tar requirement for maintainers, or run the release only in CI. | P0 | S | Gives a verifiable origin for the archive, which `release.md` admits is missing ([GitHub attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds)). Enables mise's `github:` backend with attestation checks ([mise](https://mise.jdx.dev/dev-tools/backends/github.html)). |
| DP-4 | Add `upgrade [--to <version\|archive>] --dry-run`. It fetches or verifies an archive, plans replacement of exactly the `distribution.json` files under revision guards, preserves config, plugins, templates and context, runs migrations and emits a JSON plan. Explicit only: no background auto-update. | P0 | M | Upgrades are currently manual. Peers keep updates explicit and pinnable ([Claude Code setup](https://code.claude.com/docs/en/setup)). |
| DP-5 | Version the config and data schemas with ordered migrations. Add `config migrate` (preview by default, `--write` to apply). Make "config newer than binary" a distinct error code that suggests `upgrade`. | P0 | M | `schemaVersion: z.literal(1)` gives no forward path. Biome's model is the reference ([Biome CLI](https://biomejs.dev/reference/cli/)). |
| DP-6 | Expand CI to `ubuntu-latest`, `windows-latest` and `macos-latest` (arm64) × Node 22.12/24/26. Add `.gitattributes` `* text=auto eol=lf` plus `bin/app.js text eol=lf`. Add tests for CRLF revisions, case-only renames and collisions, long paths, and a Windows-style `\` in `--out`. | P0 | M | The brief lists "no Windows/macOS CI". Runners are free for public repositories ([GitHub runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). Node 26 becomes LTS on 2026-10-28 ([nodejs/Release](https://github.com/nodejs/Release)). |
| DP-7 | Call `module.enableCompileCache()` at the top of the entry point, guarded so it never fails. Defer evaluation of heavy modules (UI renderers, Bases engine, parse5) behind lazy factories inside the single bundle. Add a startup budget test. | P1 | S | Measured drop from about 220 ms to 143 ms. The API is available on the 22.12 floor and never throws ([Node module docs](https://nodejs.org/api/module.html#module-compile-cache)). |
| DP-8 | Make writes robust on Windows. Retry `rename` and `rm` on `EPERM`/`EACCES`/`EBUSY` with bounded backoff of about 1 s. Write `{pid, host, startedAt, command}` into `.agent-cli.lock` and report a stale-lock diagnosis in the `WORKSPACE_BUSY` details. | P1 | S | Antivirus and editor locks are the documented cause of rename failures (graceful-fs, search summary). |
| DP-9 | Add a `doctor` command. It checks Node against `engines`, per-file SHA-256 hashes added to `distribution.json`, config validity and version, plugin compatibility, lock state and compile-cache status. | P1 | S | Mirrors `claude doctor` ([Claude Code setup](https://code.claude.com/docs/en/setup)) |
| DP-10 | Make plugin compatibility explicit. Add a manifest `forgeApi` range (for example `"^1"`), add a `versions.json` fallback like Obsidian's, and fix the "agent-cli" wording. Distribute plugins as npm packages with the `forge-plugin` keyword. Add `plugins install <spec> --dry-run` that copies into `bin/plugins` and records an integrity hash in config. | P1 | M | Obsidian and ESLint patterns ([Obsidian versions](https://docs.obsidian.md/Reference/Versions), [ESLint plugins](https://eslint.org/docs/latest/extend/plugins)). Avoids running a registry service. |
| DP-11 | Add `forge mcp` as a stdio MCP server generated from the `schema --json` catalog. Each tool call reuses one invocation pipeline (lock, dry-run, revisions). Publish to the MCP Registry once it is GA. | P1 | M | The stdout discipline already matches the MCP rules ([MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)). The brief lists "no MCP server" as a limit. |
| DP-12 | Add `--limit/--cursor` and an optional NDJSON output to `list` and other unbounded results. Default to compact JSON when not on a TTY. | P1 | S | 5,000 files produce 400 KB of output, which costs agent context. |
| DP-13 | Add a persistent index: a JSON cache keyed by path, mtime and size, or `node:sqlite` once the floor is at least 22.13. Optionally add `watch`, using `fs.watch` or `@parcel/watcher` snapshots for changes made between runs. | P2 | L | Only worthwhile after DP-1. `node:sqlite` is a release candidate ([Node sqlite](https://nodejs.org/api/sqlite.html)); `getEventsSince` covers offline changes ([parcel watcher](https://github.com/parcel-bundler/watcher)). |
| DP-14 | Add optional native binaries through Node SEA (`--build-sea`, Node ≥ 25.5) for users without Node, signed on macOS and Windows. Add Homebrew tap and WinGet manifests after that. | P2 | L | SEA is still Stability 1.1 and needs signing ([Node SEA](https://nodejs.org/api/single-executable-applications.html)). |
| DP-15 | Add local observability: `--trace <file>` writes event-bus records as JSONL with optional OTLP/OpenTelemetry span mapping. No remote telemetry. If telemetry is ever added, make it opt-in, honour `DO_NOT_TRACK=1`, and provide a debug mode that shows the payload. | P2 | S | Turborepo's practice ([Turborepo telemetry](https://turborepo.dev/docs/telemetry)). The GenAI conventions are still in development, so keep the mapping thin. |

The suggested sequence to 1.0 is: DP-1, DP-6 and DP-3 first; then DP-2, DP-5 and DP-4 together (one release contract); then DP-7 through DP-12.

## What not to build

- **A background auto-updater.** It conflicts with "never silently redirect writes", with committed `bin/` pinning and with agent reproducibility. Use an explicit `upgrade`.
- **A Bun or Deno compiled build as the primary artifact.** It changes the runtime under Node plugins ([Bun](https://bun.com/docs/bundler/executables), [Deno](https://docs.deno.com/runtime/reference/cli/compile/)).
- **A hosted plugin marketplace.** Use npm keywords plus a curated list in the docs, the Obsidian and ESLint pattern.
- **A migration from Commander to oclif.** The Forge's registry already gives atomic, typed contributions; DP-10 covers npm-installed plugins more cheaply.
- **Plugin "sandboxing" through the Node permission model.** The Node docs say it is not a security boundary ([Node permissions](https://nodejs.org/api/permissions.html)). At most, offer it as an opt-in seat belt and document it as such.
- **A daemon or IPC server before a persistent index exists.** Process startup is not the bottleneck: indexing is.
- **Linux distribution packages (apt, dnf, apk) before 1.0.**

## Open questions

1. Should the npm package's `bin` run directly against a workspace (a global install), or only install and upgrade a workspace's committed `bin/`?
2. Is a 22.12 floor worth keeping until April 2027, or should 1.0 require 22.13+ or 24 to use `node:sqlite` and the stable permission model?
3. Should the lock coordinate with Obsidian and editors through mtime and revision checks only, or should a cooperative lock protocol be documented for plugins?
4. Should `obsidian-bases-expression` accept a prebuilt context? (Needs upstream discussion.)
5. For monorepos, should one workspace `bin/` serve several package roots through `--root`, or should each package vendor its own copy?

## Sources

- https://code.claude.com/docs/en/setup
- https://github.com/openai/codex
- https://www.geminicli.com/docs/get-started/installation (search summary)
- https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/
- https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://nodejs.org/api/single-executable-applications.html
- https://nodejs.org/api/module.html#module-compile-cache
- https://nodejs.org/api/cli.html#--build-snapshot-entry
- https://nodejs.org/api/sqlite.html
- https://nodejs.org/api/permissions.html
- https://nodejs.org/en/about/previous-releases
- https://github.com/nodejs/Release
- https://bun.com/docs/bundler/executables
- https://docs.deno.com/runtime/reference/cli/compile/
- https://github.com/volta-cli/volta
- https://mise.jdx.dev/dev-tools/backends/npm.html
- https://mise.jdx.dev/dev-tools/backends/github.html
- https://docs.npmjs.com/cli/v11/configuring-npm/package-json#devengines
- https://biomejs.dev/reference/cli/
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://github.com/modelcontextprotocol/registry
- https://github.com/paulmillr/chokidar
- https://github.com/parcel-bundler/watcher
- https://docs.obsidian.md/Reference/Versions
- https://github.com/obsidianmd/obsidian-releases
- https://eslint.org/docs/latest/extend/plugins
- https://vite.dev/guide/api-plugin
- https://oclif.io/docs/plugins
- https://github.com/tj/commander.js
- https://git-scm.com/docs/gitattributes
- https://github.com/isaacs/node-graceful-fs (search summary)
- https://turborepo.dev/docs/telemetry
- https://github.com/open-telemetry/semantic-conventions-genai
