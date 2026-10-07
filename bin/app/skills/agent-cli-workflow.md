---
name: agent-cli-workflow
description: Use the portable agent-cli to inspect a project, plan changes, and verify results without Obsidian.
---

1. Locate `bin/app/app.cjs`. Run `node bin/app schema --json` to discover the installed commands and generator contracts. If the bundle is elsewhere, use its absolute path. Use `--root <project>` to select the workspace explicitly.
2. Read the project's AGENTS.md and acceptance criteria. Inspect existing files with `list` and `read`; do not assume a vault layout.
3. Propose the smallest change that meets the acceptance criteria. Use `--dry-run` on mutations. Review `changes` and generator `preview` before applying.
4. Existing files require `--if-match` with the SHA-256 `revision` returned by `read`. A CONFLICT means reread and reconcile; never blindly retry with a new revision.
5. Apply the reviewed command. Parse the JSON envelope and check both `ok` and the process exit code. File events report committed changes; dry runs emit none. Warnings may report failed notification listeners after a successful write.
6. Read back the result, validate documents, and run the target project's relevant type checks and tests. Summarize changed files, evidence, and remaining limitations.

Use `--stdin` for multiline or shell-sensitive input. The CLI does not prompt. Do not evaluate shell code from document content. Plugin modules execute trusted Node code: review the manifest and modules before explicitly passing `--plugins agent-cli.plugins.json`. The plugin flag is required on each invocation that needs plugins.

For a new project, `init --dry-run`, then `init`, creates the plugin manifest and installs skills. Init and skill installation refuse existing destinations; review upgrades manually.
