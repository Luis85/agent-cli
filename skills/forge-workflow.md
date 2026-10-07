---
name: forge-workflow
description: Use the portable Forge CLI to inspect a project, plan changes, and verify results without Obsidian.
---

1. Locate `bin/app/app.cjs` and `bin/config.json`. Run `node bin/app config --json` to confirm paths, defaults and enabled plugins, then `node bin/app schema --json` to discover commands and generator contracts. If the bundle is elsewhere, use its absolute path. Put routing options before the command: `node bin/app --root <project> --config <path> schema --json`. The same rule applies to `--no-plugins`; dry-run and formatting flags may appear on either side of the command.
2. Read the project's AGENTS.md and acceptance criteria. Inspect existing files with `list` and `read`; do not assume a vault layout.
3. Propose the smallest change that meets the acceptance criteria. Use `--dry-run` on mutations. Review `changes` and generator `preview` before applying.
4. Existing files require `--if-match` with the SHA-256 `revision` returned by `read`. A CONFLICT means reread and reconcile; never blindly retry with a new revision.
5. Apply the reviewed command. Parse the JSON envelope and check both `ok` and the process exit code. File events report committed changes; dry runs emit none. Warnings may report failed notification listeners after a successful write.
6. Read back the result and validate documents. For generated TypeScript projects, run `npm run check:fast` from the project directory, diagnose failures, fix their cause, rerun the failed stage, then finish with `npm run check`. Read scripts first for other projects. Never weaken a gate to conceal a failure. Summarize changed files, acceptance evidence, checks run, and remaining limitations.

Use `--stdin` for multiline or shell-sensitive input and `--key=value` for literal values beginning with `--`. The CLI does not prompt. Do not evaluate shell code from document content. Plugin modules execute trusted Node code: review each directory's manifest and entry point before adding its ID to `plugins.enabled` in configuration. Use `node bin/app --no-plugins <command>` to recover from a failing plugin. Use `--no-dry-run` or `--no-json` to override enabled configuration defaults when appropriate.

For a new workspace, `setup --dry-run`, then `setup`, initializes missing app/config, skills, an example template and lean AGENTS.md; existing destinations are skipped. Review upgrades separately. For code, inspect `project list` and `project inspect <id>`, then preview `project create <kebab-name>` or `project component <id> <PascalName> --kind domain`. To generate a note, inspect `templates list` and `templates inspect <name.md>`, supply required values with `make document <Title> --template <name.md> --values-from <inputs.json> --dry-run`, and review the complete rendered text before applying.
