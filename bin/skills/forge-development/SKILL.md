---
name: forge-development
description: Generate and extend TypeScript projects with Forge scaffolds (project create, project component, make entity, make use-case, make form, make plugin) and prove them with acceptance tests and quality gates. Use when adding domain or application code, forms or Forge plugins, or when running npm run check in a Forge-managed project.
license: MIT
compatibility: Requires Node.js 22.12 or newer and The Forge distribution in the workspace bin folder.
metadata:
  author: The Forge
  version: "0.1.0"
---

Scaffolds are starting points, not finished features. The safe edit loop and error recovery are in the `forge-workflow` skill.

## Before generating
- Define the domain language, acceptance examples, invariants and dependencies first.
- `project list`, `project inspect <id>`, then `project open <id>` and `project current`. Check `context.root` on every response.
- With parallel agents, keep the selection fixed and pass `--project <id>` to file commands. Writes in different projects still share one writer lock (`WORKSPACE_BUSY`, retryable).

## Generate
- New library: `project create <kebab-name> --dry-run`. New domain or application file: `project component [id] <PascalName> --kind domain|application --dry-run`.
- Generators: `make` lists them. Output is relative to the open project: `make entity WorkItem --out src/domain --dry-run`, `make use-case FindWorkItem --dry-run` (default `src/application`).
- Forms: `make form <PascalName> --dry-run` writes a typed definition and unit test; adapt the fields and Zod rules to the acceptance criteria. See `bin/data/docs/reference/forms.md`.
- Review the generated source, apply, then replace generic behavior with the real domain rules.
- Code generators come from the `scaffolds` core plugin and `make document` from `templates`; `plugins` shows whether they are enabled.

## Architecture
- Domain code is independent of Node, plugins, CLI parsing and storage.
- Application services orchestrate injected ports; infrastructure implements them; the composition root wires them.

## Test and check
- Test observable behavior: invalid state, success, failure, stale writes and edge cases. Use `.unit.test.ts`, `.integration.test.ts` and `.e2e.test.ts`; focus one with `npm test -- --project unit`.
- New project: `npm install` once, commit the lockfile, then `npm ci`.
- Iterate with `npm run check:fast`, fix the cause of each finding, rerun the failed stage, and finish with `npm run check`.
- Source files stay within 400 code lines and tests within 450: split cohesive responsibilities, never compress code.
- Never suppress findings or delete tests to pass. For existing projects, follow their own scripts.

## Finish
- `project close` when you return to workspace work. Do not assume another agent left the selection unchanged.

## Reference
- [Plugins](references/plugins.md): `make plugin`, command metadata, settings, strings, lifecycle, events and project CI workflows.
- [Changing The Forge](references/forge-itself.md): the Forge source checkout, its gates, evaluations and releases.
- Browser prototypes: the `forge-webviews` skill.
