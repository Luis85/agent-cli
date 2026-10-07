# Build and upgrade the portable distribution

[Documentation](../index.md) · How-to guide

Use this guide after implementing and reviewing a change. Run commands from the Forge repository with Node >=22.12, npm and GNU tar available.

```sh
npm ci
npm run release
```

`release` runs the full quality gate, rebuilds the distribution and creates the archive and checksum. Inspect the generated source/distribution diff before committing. It does not publish the archive or create a GitHub release. For individual diagnostic commands, see [develop and verify a change](develop-and-test.md).

## Artifact policy


The executable, support manifest, default configuration and packaged assets in `bin` are deliberately version controlled. Local `bin/data/context.json`, installed plugins and workspace templates are runtime data. Builds refresh distribution assets without replacing local configuration, plugins, templates or project selection. Every source/skill/doc change affecting the release must rebuild the app. CI runs the same structure, lint, analysis, type checking, build and test gates, then rejects differences in the distribution, including untracked files. CI runs the suite on the minimum supported Node 22.12.0 and Node 24. The workflow uploads diagnostic reports even when a check fails and creates a downloadable build artifact after success; it does not publish a GitHub release automatically.

The release script requires **GNU tar** on the maintainer's path as `tar` and creates `release/forge-<version>.tar.gz` plus a SHA-256 checksum file. On macOS, install GNU tar and put its `gnubin` directory on `PATH`. The script checks agreement between source, bundle manifest and executable versions, and normalizes timestamps, ownership, permissions and entry order so unchanged content produces an identical archive. Archive tests verify the checksum and reproducibility, extract into a project without `node_modules`, and execute initialization and generation from the extracted app.

The archive contains `bin/app.js`, `bin/package.json`, default `bin/config.json`, canonical defaults in `bin/config/default.json`, authored process skills in `bin/skills`, empty plugin/template directories and packaged assets under `bin/data`. It excludes local context, installed plugins and workspace templates. `setup` creates the initial template. Project selection is saved separately by `project open`/`close`. End users extract it into a new project and run `node bin/app.js`; standard tar extractors can read the archive. They do not need tar after extraction, npm packages, TypeScript, Vite or Vitest to run the app. For an existing installation, extract separately and preserve configuration, shared plugins/templates and local context while replacing the executable and packaged assets. A checksum detects transfer corruption; obtain the archive and checksum from a trusted release source.
