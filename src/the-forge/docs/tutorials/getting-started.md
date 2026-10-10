# Create your first Forge workspace

[Documentation](../index.md) · Tutorial

By the end of this exercise you will have a managed TypeScript project, a planning note and a verified understanding of where the CLI writes files. You need Node 22.12 or newer and a copy of the complete `bin` distribution. Running the CLI itself does not require npm installation; compiling a generated project does.

## 1. Install the portable distribution

Create an empty workspace directory and extract a reviewed release into it. Keep `bin/forge.js` and `bin/package.json` together. If you copy the complete `bin` folder from a source checkout instead, reset its checkout-specific settings only in this new destination:

```sh
cp bin/config/default.json bin/config.json
rm -f bin/data/context.json
```

The checkout selects its own `src/the-forge` project; a release already has generic settings and no selection. Setup preserves existing configuration, so it does not perform this reset for you. Run the remaining commands from the new workspace:

```sh
node bin/forge.js --version
node bin/forge.js setup --dry-run
node bin/forge.js setup
node bin/forge.js config --json
```

The dry run reports files that would be written. The real setup creates missing configuration, shared templates/plugins, packaged guidance and agent skills. Existing files are preserved. Each command returns a JSON envelope; continue only when `ok` is `true` and the process exits successfully.

Your workspace now contains `bin/forge.js`, `bin/config.json`, shared `bin/templates` and `bin/plugins`, and packaged assets in `bin/data`. The default managed-project directory is `projects`.

## 2. Create and select a project

```sh
node bin/forge.js project create learning-workspace --dry-run
node bin/forge.js project create learning-workspace
node bin/forge.js project open learning-workspace
node bin/forge.js project current --json
```

Inspect the last response's `data.project`. The selected project persists across invocations. Future file commands use `projects/learning-workspace` as their root until you close it; verify `context.root` in each command response.

## 3. Create and inspect a planning note

```sh
node bin/forge.js create notes/plan.md --content '# First feature' --dry-run
node bin/forge.js create notes/plan.md --content '# First feature'
node bin/forge.js read notes/plan.md --json
```

The note is in `projects/learning-workspace/notes/plan.md`. The read response contains its contents and SHA-256 `data.revision`. Existing-file edits require that revision so another editor's work is not silently replaced.

Copy the actual revision into this command, replacing `YOUR_REVISION`:

```sh
node bin/forge.js properties notes/plan.md --set '{"status":"draft"}' --if-match YOUR_REVISION --dry-run
node bin/forge.js properties notes/plan.md --set '{"status":"draft"}' --if-match YOUR_REVISION
node bin/forge.js read notes/plan.md --json
```

The final read shows the new frontmatter and a new revision. A stale revision produces `CONFLICT`; reread and reconcile before retrying. Dry runs emit no file events and reserve no files.

## 4. Preview a scaffold and return to workspace scope

```sh
node bin/forge.js make entity WorkItem --dry-run
node bin/forge.js project close
node bin/forge.js project current --json
```

The entity preview shows proposed TypeScript without writing it. The final current-project result is `null`; file paths now resolve from the workspace again. The project remains available for later selection.

You have completed the first workflow. Continue with [your first Markdown-defined UI](first-ui.md), the [idea-to-production walkthrough](idea-to-production.md), or [manage projects](../how-to/manage-projects.md) for installation and verification of the generated project's toolchain. Use the [command reference](../reference/cli.md) when you need an exact option or error contract.
