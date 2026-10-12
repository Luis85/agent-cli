# Install a GitHub release and start a project

[Documentation](../index.md) · How-to guide

Use a pinned release in a new workspace or an existing repository without `bin/`. Requires **Node 22.12 or newer**, curl and tar. The app needs no npm installation or repository source.

## Agent-executable workflow

```sh
curl -fL https://github.com/Luis85/agent-cli/releases/download/v0.1.0/install-forge.mjs -o install-forge.mjs
node install-forge.mjs --version 0.1.0 --workspace ./my-workspace
cd my-workspace
node bin/forge.js project create my-project --dry-run
node bin/forge.js project create my-project
node bin/forge.js project open my-project
node bin/forge.js project current --json
```

In PowerShell, download the installer with `Invoke-WebRequest https://github.com/Luis85/agent-cli/releases/download/v0.1.0/install-forge.mjs -OutFile install-forge.mjs`, then use the same Node commands. Check `$LASTEXITCODE` after each invocation; stop on a nonzero status.

The installer downloads the archive and checksum from the pinned GitHub release, verifies SHA-256, checks archive paths and file types, verifies the executable version and generic defaults, installs the complete `bin/`, and runs setup. It prints JSON with `ok`, `version`, `workspace`, `checksum` and next commands. A failure exits nonzero. Keep the downloaded installer outside the destination workspace.

For an existing repository without `bin/`, pass its path as `--workspace`. Setup preserves existing files and AGENTS.md. The installer refuses an existing `bin/`; follow the [upgrade guide](release.md#artifact-policy) instead of resetting settings. It never adopts this source checkout's `src` project path or saved project selection.

An agent checks exit status and JSON `ok`, reviews the project preview, then verifies `project current` before file operations. Read the installed `.agents/skills/forge-workflow/SKILL.md` and workspace AGENTS.md. File paths follow the selected project. Run `npm ci` and `npm run check` inside `projects/my-project` for development; these dependencies belong to the generated project.

For a Vue/Nuxt UI prototype, use `project create my-project --type webview`. Inspect the workspace with `server start --webview admin --json` and open its returned URL. Chromium is optional and separate: run `browser install` explicitly or provide `--browser-executable` before browser capture.

## Download once and install offline

The release provides `forge-0.1.0.tar.gz` (the complete app), `forge-0.1.0.tar.gz.sha256` (archive checksum), and `install-forge.mjs` (installer). Download all three to one directory with a browser, curl or GitHub CLI:

```sh
gh release download v0.1.0 --repo Luis85/agent-cli --dir ./forge-download --pattern 'forge-0.1.0.tar.gz*' --pattern install-forge.mjs
node ./forge-download/install-forge.mjs --version 0.1.0 --assets ./forge-download --workspace ./my-workspace
```

`--assets` performs no download and needs only Node and tar. A checksum detects corruption; obtain both the installer and checksum from a trusted release. The archive and checksum can also be downloaded and extracted manually: verify with `sha256sum -c forge-0.1.0.tar.gz.sha256` (Linux), `shasum -a 256 -c forge-0.1.0.tar.gz.sha256` (macOS), or `Get-FileHash` (PowerShell), then extract into a new directory and run `node bin/forge.js setup`.
