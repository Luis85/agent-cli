# Build, publish and upgrade the portable distribution

[Documentation](../index.md) · How-to guide

Use this guide after implementing and reviewing a change. Run commands from the Forge project directory `src/the-forge` with Node >=22.12, npm and GNU tar available.

When changing the developer admin webview, first run `npm ci`, `npm run build`, and `npm run package` from its independent project directory, `src/forge-admin`. Its explicit `config.distribution` publishes only `bin/webviews/admin` and refreshes those entries in the distribution manifest. Run its `npm run check` with Playwright Chromium installed to verify the browser experience, and `npm run package:check` to compare the build with the published assets. The Forge build consumes the published assets in `bin`; it never imports or builds a sibling project's source. Rebuilding Forge preserves that webview bundle. Commit both projects' changes and the assembled distribution together.

```sh
cd src/the-forge
npm ci
npm run release
```

`release` runs the full quality gate, rebuilds the distribution and creates the archive and checksum. Inspect the generated source/distribution diff before committing. It does not publish the archive or create a GitHub release. For individual diagnostic commands, see [develop and verify a change](develop-and-test.md).

## Artifact policy


The executable, support manifest, default configuration and packaged assets in `bin` are deliberately version controlled. This repository also tracks its self-management settings: `bin/config.json` uses `paths.projects: "src"`, and `bin/data/context.json` selects `the-forge` at `src/the-forge`. Installed plugins, workspace templates and other workspaces' active settings remain operating data. Builds refresh distribution assets without replacing configuration, plugins, templates or project selection. Every source/skill/doc change affecting the release must rebuild the app. CI runs the same structure, lint, analysis, type checking, build and test gates, then rejects differences in the distribution, including untracked files. CI runs the suite on the minimum supported Node 22.12.0 and Node 24. The workflow uploads diagnostic reports even when a check fails and creates a downloadable build artifact after success; publication is handled separately by the release workflow described below.

Run the release from the Forge project directory `src/the-forge`. The release script archives the workspace `bin/` that `config.distribution` in `package.json` names, requires **GNU tar** on the maintainer's path as `tar` and creates `src/the-forge/release/forge-<version>.tar.gz` plus a SHA-256 checksum file. On macOS, install GNU tar and put its `gnubin` directory on `PATH`. On Windows, put the `usr\bin` directory of Git for Windows first on `PATH`; it contains GNU tar. CI builds the published archive on Linux. The script checks agreement between source, bundle manifest and executable versions, normalizes timestamps, ownership, permissions and entry order, and compresses with Node's zlib (no gzip timestamp, file name or platform byte) so unchanged content produces an identical archive on every packaging platform. Archive tests verify the checksum and reproducibility, extract into a project without `node_modules`, and execute initialization and generation from the extracted app.

The archive contains the launcher `bin/forge.js`, the runtime bundle `bin/forge-runtime.js` it loads, the independent server bundle `bin/forge-server.cjs`, the built admin application and notices in `bin/webviews/admin`, `bin/package.json`, default `bin/config.json`, canonical defaults in `bin/config/default.json`, process skills in `bin/skills/<id>/SKILL.md` (packaged from the project's authored `skills/<id>/SKILL.md` folders), empty plugin/template directories and packaged assets under `bin/data`. The CLI and server are separately bundled, self-contained Node processes; the Vue application remains static browser assets. Packaging substitutes generic configuration with `paths.projects: "projects"` and excludes the checkout's context, installed plugins, workspace templates, local server state and other locally installed webviews. It does not reset the source checkout. `setup` creates the initial template. Project selection is saved separately by `project open`/`close`. End users extract it into a new project and run `node bin/forge.js`; standard tar extractors can read the archive. They do not need tar after extraction, npm packages, TypeScript, Vite or Vitest to run the app. For an existing installation, extract separately and preserve configuration, shared plugins/templates and local context while replacing `bin/forge.js`, `bin/forge-runtime.js`, `bin/forge-server.cjs`, `bin/webviews/admin`, `bin/package.json` and the packaged assets together; bundles of different releases do not mix. A launcher without its runtime bundle answers every command with `INVALID_SETUP` naming the missing file. A checksum detects transfer corruption; obtain the archive and checksum from a trusted release source.

A manual copy of the repository's entire `bin` folder includes its self-management settings. Only in a new destination, copy `bin/config/default.json` over `bin/config.json` and remove `bin/data/context.json` before setup. Do not apply that reset to the source checkout or an existing user installation; use the archive for a generic distribution without these extra steps.

## Publish a version with an agent

The authored workflow `src/infrastructure/workflows/release/release.yml` generates `.github/workflows/the-forge--release.yml`. Pull requests and manual dispatches build and test a candidate without publishing. Tags matching `v<package version>` publish only after checks and six fresh-installation jobs pass on Linux, macOS and Windows with Node 22.12 and 24. The tag commit must be on main.

1. Update `package.json`, its lockfile, authored skill version metadata and `docs/releases/<version>.md` together when changing the version. Rebuild the complete app and showcase, synchronize workflows, run the full gate, and merge the reviewed changes to main with green CI. For 0.1.0, the source version is already set.
2. Run the release workflow through a pull request or `gh workflow run the-forge--release.yml --ref main`, then inspect the run and every installation job. Manual dispatch never publishes.
3. Cut the annotated version tag from the validated main commit and push it:

```sh
git switch main
git pull --ff-only origin main
git tag -a v0.1.0 -m 'The Forge 0.1.0'
git push origin v0.1.0
gh run list --workflow the-forge--release.yml --event push
# Use the returned run ID.
gh run watch <run-id> --exit-status
gh release view v0.1.0 --repo Luis85/agent-cli
```

The workflow builds one checksummed archive and installer, tests those exact artifacts on the platform matrix, then uploads them to a draft release. It downloads the draft assets with GitHub CLI, compares them with the candidate and repeats installation, project creation, generation and admin-server checks before publishing. Finally it downloads the public installer and executes the same online workflow users run. GitHub's workflow token supplies publication credentials; no personal token is needed.

On failure before publication, the release stays draft and the run fails. Diagnose the failed stage and rerun after fixing its cause. The publishing job can resume an existing draft and reverify its assets; it refuses to replace an already published release. Never move an already published version tag to different code; use a new patch version.

The first release's user-facing [notes](../releases/0.1.0.md) and [installation guide](install.md) document the pinned download URLs, prerequisites, checksum validation and new-project commands.
