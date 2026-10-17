---
name: forge-webviews
description: Create, customize, test and publish self-contained Vue 3 and Nuxt UI prototypes with Forge project scaffolds, Playwright and the CLI-managed localhost server. Use when a user requests a new webview, a fast interactive prototype, a local dashboard or an iteration on a Forge webview.
license: MIT
compatibility: Requires Node.js 22.12 or newer and The Forge distribution in the workspace bin folder. Building a prototype also needs npm; browser tests need Playwright Chromium.
metadata:
  author: The Forge
  version: "0.1.0"
---

A prototype is editable project code, not evidence of production readiness. Keep its fixtures clearly marked as sample data.

## Plan
- Settle the audience, main task, sample content and observable acceptance criteria. Choose sensible defaults; ask only when a missing decision blocks useful work.
- Read AGENTS.md, then `schema project`, `schema webview` and `schema server` as needed. Check `project list` and `project current`.
- Prefer `--project <id>` over changing the shared selection while other agents work.

## Create
- Preview `project create <kebab-name> --type webview --dry-run`, review the file plan, then create it. It is an independent Vue 3, Nuxt UI and Vite project with its own package, tests, scripts, Playwright setup and local fixtures.
- Never assume a sibling project's dependencies or source, and do not add library scaffolds with `project component`.
- Read the generated README, AGENTS.md and scripts. Customize the Vue source and sample model; keep a usable empty state, long labels and a meaningful primary interaction.
- Use local assets and relative URLs: views are served at `/views/<id>/` with no SPA history fallback or external CDN.

## Build and test
- In the project: `npm install` once, commit the lockfile, then `npm ci`. `npm run browsers:install` installs browser support.
- Iterate with `npm run check:fast`, finish with `npm run check`, and `npm run build` for the static output. Project scripts run trusted code outside Forge's dry-run guarantee.
- Test the built view through the real CLI with Playwright: the primary interaction, the empty state, keyboard focus, a narrow layout and no unexpected browser errors.
- Inspect desktop and mobile screenshots and attach or link them; a path in a test log is not a delivered image.

## Publish and preview
- From the workspace: `webview publish --project <id> --dry-run`, review the destination and revisions, then publish. `webview publish --project <id> --check` verifies the installed output (`WEBVIEW_DRIFT`, exit 5).
- Replacing a changed installed view: pass `data.revision` from `webview inspect --project <id>` as `--if-match` to the preview and the publish. Never hand-edit `bin/webviews`.
- Publishing copies built assets; it never installs dependencies or runs build scripts.
- When the user agrees to a preview: `server status`, then `server start --webview <id>`, and return `data.url`. A running server needs a stop and start to discover a newly published view; changed files of a mounted view need a browser reload.
- Keep launch tokens out of commits, logs and screenshots. Stop the server when the session no longer needs it.

## Data
- Default to local sample data. For real workspace data, use only the read-only system API in `bin/data/docs/reference/server.md`: take the token from the URL fragment, remove it from the address bar and send it as a bearer header to the same origin.
- Show missing access, loading, unavailable and stale data clearly. Configuration changes, file writes and shutdown stay with the CLI.

## Report
- Name the project, preview location, checks run, screenshots and remaining limits. See `bin/data/docs/how-to/prototype-webviews.md` and `bin/data/docs/reference/webviews.md`.
- Captures and illustrated walkthroughs: the `forge-browser` skill.
