# Working on The Forge

Read README.md and docs/architecture.md. Keep domain/application independent of Node and infrastructure; inject ports and compose at src/main.ts. Commands return JSON without prompts or stdout logs. Route writes through workspace orchestration with dry-run, revision guards and post-commit events.

Define acceptance examples, then make focused changes and test observable behavior: file integrity, plugin lifecycle and portable execution. Use established libraries. Use the test pyramid: `.unit.test.ts` for isolated behavior, `.integration.test.ts` for collaborating boundaries, and `.e2e.test.ts` for complete workflows. Keep authored source files within 400 code-bearing lines and tests/support within 450; exclude blank and comment-only lines, but count lines containing both code and comments; extract cohesive responsibilities, never compress code to game the cap. Keep help, docs and skills accurate; structural validation does not prove Obsidian rendering or expression evaluation.

Run `npm ci` once, then `npm run check:fast` during iteration. Diagnose failures, fix their cause, and rerun the failed stage before the full `npm run check`. Never weaken checks to hide failures. The full gate rebuilds `bin/app.js` and packaged assets and tests the standalone distribution; commit source, docs and regenerated distribution together. Keep fixed bin paths and workspace/project scope explicit; context selection must never silently redirect writes. Preserve user config, plugins, templates and local context when rebuilding. Report checks run and any unresolved failures. See docs/development.md for diagnostic commands.

Before the first release, change contracts directly; do not add backward-compatibility layers.
