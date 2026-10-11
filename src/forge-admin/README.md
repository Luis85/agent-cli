# Forge admin

A read-only Vue 3 + Nuxt UI developer webview, served by The Forge's independent local server. It shows workspace/project context, runtime status, projects, plugins and capability counts. All system changes stay in the CLI.

## Open the view

From a workspace containing the complete Forge `bin/` distribution:

```sh
node bin/forge.js server start --webview admin
node bin/forge.js server status
node bin/forge.js server stop
```

Open the URL returned by `server start`. The CLI does not open a browser or prompt automatically; an agent can offer to start the view before running the command. The server binds to `127.0.0.1`; the returned URL includes an access token in its fragment. The view clears that fragment, retains the token in tab session storage and authenticates read-only `/api/system` requests. A server restart requires a fresh link. Treat the returned URL as a local credential.

## Develop independently

Requires Node 22.12 or newer. Run these commands inside `src/forge-admin`:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run package
```

The project owns its package, lockfile, Vue/Vite/TypeScript configuration and tests. It never imports sibling source or `node_modules`. `npm run build` produces static `dist/` assets at the `/views/admin/` base URL, together with `manifest.json` and dependency notices. `npm run package` publishes those built assets to the explicit `config.distribution` target (`../../bin/webviews/admin`) and refreshes the Forge asset manifest. `npm run package:check` verifies that the committed distribution matches the build.

After packaging, start the server using the repository CLI and open its returned URL. The server serves the latest packaged assets; reload after rebuilding and packaging. `npm run dev` is only the standalone frontend Vite server and has no Forge API, so use the CLI-managed view for system inspection and integration work.

## Browser inspection and tests

```sh
npm run browsers:install
npm run test:e2e
npm run test:e2e:ui
```

Playwright starts and stops the real server through the public CLI inside an isolated temporary workspace. It exercises authenticated loading, read-only requests, refresh, search, missing/expired access, disconnection recovery, unavailable selection after a project marker disappears, and mobile/keyboard behavior, and captures desktop/mobile screenshots. It does not change your selected project or start a server in your working workspace.

`FORGE_CLI=/absolute/path/to/bin/forge.js` selects another built distribution. The default is the repository's shipped `bin/forge.js`, consumed as an external executable. If browser downloads are unavailable, `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium` selects an installed Chromium. Run `npm run check` for type checking, unit tests, production build and browser tests; it requires a built CLI distribution with server support.

## Contract and scope

`src/system.ts` describes and validates the version 1 `/api/system` transport envelope. The snapshot includes workspace context, projects, runtime info, plugin state and declared capability counts; there are no configuration writes or generic command-execution endpoints. This independent frontend duplicates the small public transport contract intentionally; browser tests verify it against the shipped server. When the contract changes, update validation and the server together.

Manual refresh and a 15-second auto-refresh interval read the latest state. Auto-refresh starts enabled, can be switched off and pauses in hidden tabs. Network failures retain the last successful snapshot with a visible stale-state explanation. Per-section availability flags distinguish an empty inventory from a failed inspection. Unavailable project selection never implies workspace scope, and unavailable capabilities never render as zero. No values are invented when data is missing.

See [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) for the product scope and design conventions.
