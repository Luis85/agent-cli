# Working on The Forge

Read README.md and docs/architecture.md. Keep domain/application independent of Node and infrastructure; inject ports and compose at src/main.ts. Commands return JSON without prompts or stdout logs. Route writes through workspace orchestration with dry-run, revision guards and post-commit events.

Define acceptance examples, then make focused changes and test observable behavior: file integrity, plugin lifecycle and portable execution. Use established libraries. Keep help, docs and skills accurate; structural validation does not prove Obsidian rendering or expression evaluation.

Run `npm ci` once, then `npm run check:fast` during iteration. Diagnose failures, fix their cause, and rerun the failed stage before the full `npm run check`. Never weaken checks to hide failures. The full gate rebuilds `bin/app` and tests the standalone bundle; commit source, docs and regenerated `bin/app`/`bin/config.json` together. Report checks run and any unresolved failures. See docs/development.md for diagnostic commands.

Before the first release, change contracts directly; do not add backward-compatibility layers.
