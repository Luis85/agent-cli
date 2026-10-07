# Set up and manage projects

[Documentation](../index.md) · How-to guide

`setup` initializes the workspace with a fixed layout. It creates missing files and reports existing destinations as skipped, preserving local instructions, configuration, templates and project selection.

```sh
node bin/app.js setup --dry-run
node bin/app.js setup
```

```text
bin/
  app.js
  config.json
  package.json
  plugins/
  templates/
  data/
    context.json          # saved when selecting a project
projects/                 # configurable with paths.projects
```

`bin/package.json` keeps `app.js` executable under either ESM or CommonJS parent projects. `bin/data` holds packaged documentation, type declarations and notices; authored skills live in `bin/skills`, and shipped defaults in `bin/config/default.json`. Setup installs process skills in workspace `.agents/skills` and creates a lean workspace `AGENTS.md`.

To initialize another existing directory, run `node /absolute/path/to/bin/app.js --root /absolute/path/to/workspace setup`. The workspace root must exist. Setup always targets the workspace, even while a project is open. It does not install npm packages or silently upgrade existing application files; replace a bundle explicitly from a reviewed distribution.

## Independent library projects

Each managed project is a TypeScript library under `paths.projects`, default `projects`. Set that configuration value to `src` or another workspace-relative directory when preferred. Projects have their own build/test setup and a marker used for discovery; unrelated directories are not assumed to be managed projects.

```sh
node bin/app.js project list --json
node bin/app.js project create knowledge-core --dry-run
node bin/app.js project create knowledge-core
node bin/app.js project inspect knowledge-core --json
node bin/app.js project open knowledge-core
node bin/app.js project current --json
node bin/app.js project component WorkItem --kind domain --dry-run
node bin/app.js project component WorkItem --kind domain
node bin/app.js project component FindWorkItem --kind application
```

Use lowercase kebab-case project IDs and PascalCase component names. Project creation provides strict TypeScript, Vite, Vitest, domain/application/infrastructure boundaries and focused agent instructions. Components use the project's existing layout. The starter includes a typed `ProjectDetailsForm` and a Vite HTML showcase; `make form <Name>` adds a definition and its unit tests to an open project. See [forms and preview](../reference/forms.md). Preview the generated source and adapt generic invariants and ports to the actual domain; a generated class is not a completed business feature.

## Persistent project context

`project open <id>` selects a managed project for subsequent invocations. It persists in workspace `bin/data/context.json`; there is no interactive shell or long-running process. Check `project current` and its `data.project` before a series of edits. Read target files and verify those responses' `context.root` before applying changes. With `knowledge-core` open:

```sh
node bin/app.js create notes/plan.md --content '# Plan'
node bin/app.js make entity Decision --dry-run
node bin/app.js make document 'Feature proposal' --template entity.md --dry-run
node bin/app.js project close
```

The first command creates `projects/knowledge-core/notes/plan.md` with the default projects directory. TypeScript generation defaults to that project's `src/domain`; document generation defaults to its `notes`. Templates are read from workspace `bin/templates`, so all projects can reuse the same sources. `--values-from` and file-copy inputs resolve inside the active project. Skill installation defaults to its `.agents/skills`.

`project list`, `create` and `inspect` operate on the workspace's managed-project directory. `project inspect` without an ID inspects the selected project. `project component <id> <Name>` targets an explicit managed project; omit the ID to use the open project. `project close` clears selection and restores workspace-relative document paths. Context-changing commands support `--dry-run`; previews do not change the selection. A corrupt selection fails with `INVALID_PROJECT_CONTEXT`; a missing or invalid selected project fails with `STALE_PROJECT_CONTEXT`. Writes never silently fall back to the workspace. Commands that require a selection fail with `PROJECT_REQUIRED` when none is open. Use project discovery and `project close` to recover, then open a valid project.

Selection is shared by CLI invocations using the same workspace. Coordinate agents before changing it; check each mutation's returned `context` to verify the target. `--root` chooses a workspace, not an alternative spelling for an open project.

Saved selection includes the project's workspace-relative directory. Changing `paths.projects` makes the selection stale, even if the new directory contains a project with the same name. Run `project open <id>` to explicitly select the new location, or `project close` to return to workspace scope. Older selection files without a directory are invalid and can be repaired with the same commands.

## Project quality checks

The distributed Forge CLI requires only Node. Building and testing a generated TypeScript project uses its own development dependencies, including Oxlint 1.86.0 and fallow 3.31.0 native binaries. The scaffold does not install packages or fabricate a lockfile. Install from the project directory, review and commit the generated `package-lock.json`, then use `npm ci` for repeat installations and CI:

```sh
cd projects/knowledge-core # use your configured projects path
npm install
npm run check:fast
npm run check
npm run dev # open the printed local URL to preview forms
```

`check:fast` runs structure validation, lint, static analysis and type checking. The full `check` adds library/declaration and HTML-preview builds plus tests. Static analysis checks unused code/dependencies and layer boundaries; `src/index.ts` is the intentional public API. Keep public exports narrow and retain meaningful behavioral coverage as the implementation grows.

Oxlint enforces source files at a 400-code-line limit and test files/support a 450-code-line limit. Count lines containing code; exclude blank lines and comment-only lines, including multiline comments. A line containing both code and a comment still counts. `check:structure` checks test labels/locations; `typecheck` covers both source and tests. Use `*.unit.test.ts`, `*.integration.test.ts` and `*.e2e.test.ts` to classify tests by scope. In the Forge repository, organize them under `tests/<concern>/` with shared helpers in `tests/support`; use the generated project’s own test layout when working there. Prefer many focused unit cases, integration checks at real boundaries and fewer complete end-to-end workflows. Run one layer with `npm test -- --project unit` (or `integration` / `e2e`). Split cohesive responsibilities instead of compressing code to pass a size gate.

For an agent, use this feedback loop:

1. Read the project `AGENTS.md`, README and scripts; establish acceptance examples before editing.
2. Make one focused change, add meaningful tests, and run `npm run check:fast`.
3. Diagnose each failure and fix its cause. Use `npm run check:structure`, `npm run lint` or `npm run analyze` for structured diagnostics; npm may also print its script banner, so read `.quality-reports/structure.json`, `.quality-reports/oxlint.json` and `.quality-reports/fallow.json`, or invoke `node scripts/quality/structure.mjs`, `node scripts/quality/lint.mjs` and `node scripts/quality/analyze.mjs` directly to parse stdout.
4. Rerun the failed stage (`check:structure`, `lint`, `analyze`, `typecheck`, `build` or `test`), then finish with `npm run check` from the project directory.
5. Review the diff and report the acceptance evidence, checks run and any unresolved failures. Do not delete coverage, broaden exclusions or suppress findings merely to pass a gate.

The Forge's repository checks validate the scaffold and distribution; they do not validate business behavior added later to a generated project. Run the selected project's own checks after scaffolding components or editing its code.

Project mutations use the same contained paths, collision checks, dry-run previews and post-commit events as other commands. They do not overwrite existing source files. Use `read`, guarded edits and the target project's toolchain for subsequent changes. Keep workspace and project AGENTS.md files brief: describe boundaries, actual commands and the evidence expected before delivery.
