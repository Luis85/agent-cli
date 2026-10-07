# Working on The Forge

Read README.md and docs/architecture.md. Keep domain/application independent of Node and infrastructure; inject ports and compose at src/main.ts. Commands return JSON without prompts or stdout logs. Route writes through workspace orchestration with dry-run, revision guards and post-commit events.

Use established libraries and test observable behavior, especially file integrity, plugin lifecycle and portable execution. Keep help, docs and skills accurate. Run npm run check, then commit source with rebuilt bin/app and bin/config.json. Structural validation does not imply Obsidian rendering or expression evaluation.

Before the first release, change contracts directly; do not add backward-compatibility layers.
