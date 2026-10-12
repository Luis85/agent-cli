# __FORGE_WEBVIEW_ID__

A self-contained Vue 3 and Nuxt UI webview. This is a working prototype with explicitly labeled sample data. Search and save actions only change this tab's memory; there is no backend dependency or persistence.

## Develop

Run from this project directory with Node 22.12 or newer:

```sh
npm install
npm run dev
```

Commit the new `package-lock.json`; use `npm ci` after that. The Vite URL includes `/views/__FORGE_WEBVIEW_ID__/`. Edit `src/App.vue`, replace the illustrative model in `src/prototype.ts`, and capture the purpose and acceptance criteria in `PRODUCT.md`. Keep the visual decisions in `DESIGN.md` current. Build output is static `dist/`.

## Verify and inspect

```sh
npm run browsers:install
npm run check
```

`check:fast` runs typechecking and unit tests. `check` also builds and runs Playwright against a temporary workspace served by the portable Forge CLI. No sibling source or toolchain is imported. If the project is moved outside its original workspace, set `FORGE_CLI` to an absolute path to a compatible `bin/forge.js` for browser tests. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects an already installed Chromium executable.

Playwright captures `desktop.png` and `mobile.png` under `test-results/`, tests keyboard interaction, and retains diagnostics on failure. Open those files and provide visible screenshot links with a handoff; a test result alone does not show the user the interface. Use `npm run test:e2e:ui` for interactive inspection.

## Publish through the CLI

From the containing workspace:

```sh
node bin/forge.js webview inspect --project __FORGE_WEBVIEW_ID__
node bin/forge.js webview publish --project __FORGE_WEBVIEW_ID__ --dry-run
node bin/forge.js webview publish --project __FORGE_WEBVIEW_ID__
node bin/forge.js server start --webview __FORGE_WEBVIEW_ID__
```

Build first with `npm run build`. `npm run package -- --dry-run` is a project-local convenience for the same publish command; it does not build or approve a replacement. For a changed existing installation, copy `data.revision` from `webview inspect` into both publish commands as `--if-match REVISION`. Use `webview publish --project __FORGE_WEBVIEW_ID__ --check` to verify publication. Review the CLI JSON response and open its returned URL yourself; the CLI never opens a browser or prompts.

If the server was already running before this view was first published, stop and start it so it discovers the new mount. Updated files at an existing mount become available on reload. `server stop` stops the shared workspace server, including every webview using it; coordinate with the user before interrupting other views.

`public/manifest.json` owns the installed identity, which must match the project name. The package configuration and Vite base use that same identity. Publishing changes only this view under `bin/webviews/`; only the contents of `dist/` are published. Review that output: credentials and private data must never be placed in public assets or compiled into the frontend. Keep assets in `public/` or import them through Vite. List dynamically selected icons in `vite.config.ts` under `icon.clientBundle.icons` so they render offline; the server blocks external icon/CDN requests. Use memory or hash routes if navigation is added. The default sample does not call Forge APIs; it discards the launch token from the address before rendering. Do not send a launch URL or token to another origin, analytics, logs, or screenshots.

## CI

The project owns `src/infrastructure/workflows/check/check.yml`. After committing its lockfile, run `node bin/forge.js workflows sync` from the workspace to generate the workflow entrypoint. CI installs this project's dependencies, checks its build and browser behavior, and uploads Playwright screenshots and reports.
