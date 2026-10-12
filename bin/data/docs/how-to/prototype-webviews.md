# Prototype a self-contained webview

[Documentation](../index.md) · How-to

Create a Vue 3 and Nuxt UI prototype with local sample data, an independent toolchain and Playwright tests. Build it in its own project, publish static assets through Forge, and preview it through the same localhost server that serves the admin view. The `forge-webviews` skill guides an agent through this process; inspect it with `skills show forge-webviews` or [install the skills](install-agent-skills.md).

## Create the project

From the workspace root:

```sh
node bin/forge.js project current --json
node bin/forge.js project create idea-board --type webview --dry-run
node bin/forge.js project create idea-board --type webview
node bin/forge.js project inspect idea-board --json
```

Inspect the preview and check `ok` and the exit status before continuing. The configured projects directory determines the destination: this repository uses `src/idea-board`, while a generic workspace defaults to `projects/idea-board`. Creation does not change project selection. The returned directory is the authority; the commands below run inside it.

The starter owns its package, Vue source, local fixture/model, Vite configuration, unit tests, Playwright tests and documentation. It imports no sibling project's source or toolchain. Customize the sample content and main interaction around a concrete task, and keep the sample-data label until the view actually uses another source.

## Install, iterate and verify

In the new project directory:

```sh
npm install
npm run browsers:install
npm run check:fast
npm run check
```

Review and commit the generated package lockfile. Use `npm ci` for subsequent installations. `npm run dev` provides a local Vite development preview; `npm run build` produces the static `dist/` consumed by publication. Inspect the generated scripts for the full check sequence.

The browser suite starts the actual portable CLI in an isolated temporary workspace, mounts the built view and stops its server during cleanup. Run `npm run test:e2e` after a build for focused browser verification. It exercises desktop and mobile layouts and writes screenshots under the project's `test-results/`. Inspect the images and share them as attachments or accessible links; test output alone does not show a user the pictures. Adapt assertions as the prototype changes, keeping checks for its primary interaction, keyboard use, narrow layout and unexpected browser errors.

Keep all scripts, styles, fonts and images local. Forge's content policy blocks external CDNs. Use relative asset URLs and hash navigation if routing is needed: the core server serves explicit static files and has no SPA history fallback. A successful Vite preview alone does not prove that the packaged view works under `/views/idea-board/`.

## Publish and preview

After building, return to the workspace root:

```sh
node bin/forge.js webview publish --project idea-board --dry-run
node bin/forge.js webview publish --project idea-board
node bin/forge.js webview publish --project idea-board --check
node bin/forge.js server status --json
node bin/forge.js server start --webview idea-board --json
```

Explicit `--project` routing targets this invocation without changing the shared selection. Publication copies the built assets into `bin/webviews/idea-board`; it does not install npm packages, build code or start a server. Check the publication preview. On later iterations, run `node bin/forge.js webview inspect --project idea-board --json`, review its comparison, and pass `data.revision` as `--if-match <revision>` to both the dry run and publication. See the [webview reference](../reference/webviews.md) for the complete replacement contract.

Open the complete `data.url` returned by startup. A running server retains the catalog it discovered when it started. If it predates this new view, coordinate `server stop` followed by `server start --webview idea-board`; this temporarily affects every view served by that workspace. Rebuilding and publishing an existing mounted view only needs a browser reload. Keep authenticated launch URLs private to the local session.

When the preview session is finished and other work no longer needs the server:

```sh
node bin/forge.js server stop --json
```

## Repeat the loop or add workspace inspection

Edit the project's source and fixtures, run its checks, rebuild, preview the publication changes, publish with the current guard and reload. The source project remains editable and self-contained; published files are build output. Forge refuses conflicting destinations rather than silently replacing them.

Local sample data is the default and requires no API token. If the prototype needs actual workspace state, consume the existing [read-only system API](../reference/server.md#http-contract). Use the same-origin endpoint, fragment-token handoff and bearer authorization described there. Validate the schema version and per-section availability, and design missing-access, loading, failure and stale-data states. Do not expose arbitrary CLI commands, filesystem writes or configuration editing through the browser. Server lifecycle stays in the CLI.

For a screenshot outside the regression suite, or an illustrated explanation of a problem or user flow, use [browser evidence and tutorials](capture-browser-evidence.md). The browser commands work with any supported HTTP(S) page and write scoped, guarded assets and documents.
