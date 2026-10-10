# Generate editable workflow documents

[Documentation](../index.md) · How-to guide

Use this guide to create PRDs, use cases, build specifications, designs and delivery plans from shared Markdown templates. The workspace must contain the portable Forge distribution. Templates are workspace-shared; rendered documents belong to the selected project, or to the workspace when no project is open.

## Install and inspect the pack

New workspace setup installs the pack. To add missing templates to an existing workspace:

```sh
node bin/forge.js templates install workflow --dry-run
node bin/forge.js templates install workflow
node bin/forge.js templates list --json
node bin/forge.js templates inspect workflow/prd.md --json
```

Inspect `requiredVariables` before rendering. All seven built-in workflow templates require `owner`; `title` and `date` are supplied by the command. Existing template files are preserved, so teams can edit `bin/templates/workflow/*.md` without losing their conventions on installation.

## Render into the intended scope

Confirm the project selection, then preview and create a document:

```sh
node bin/forge.js project current --json
node bin/forge.js make document 'Purchase approvals PRD' --template workflow/prd.md --values '{"owner":"Product team"}' --out docs/planning --date 2026-10-07 --dry-run
node bin/forge.js make document 'Purchase approvals PRD' --template workflow/prd.md --values '{"owner":"Product team"}' --out docs/planning --date 2026-10-07
```

Verify `context.root` in the response. The output is `docs/planning/Purchase approvals PRD.md` within that scope. An existing destination causes a conflict. `--date` makes the template's date substitutions reproducible; omit it when the current date is intended. For longer inputs, use a scope-relative `--values-from inputs.json` file instead of inline JSON.

Choose another template from the [pack reference](../reference/templates.md#workflow-template-pack) for a use case, build specification, design, implementation plan, test plan or release plan. Replace starter instructions with evidence, preserve unresolved questions as unknowns, and link requirements to design decisions, implementation and tests. Use revision-guarded file operations for later updates.

Follow the [idea-to-production tutorial](../tutorials/idea-to-production.md) for a filled-in example across stages. Template generation produces a draft document; running it does not perform user research, implement code, execute tests or deploy a release.
