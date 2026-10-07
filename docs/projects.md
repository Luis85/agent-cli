# Workspace setup and TypeScript projects

The Forge separates workspace setup from project creation. `setup` installs the portable app/config, process skills, an example Markdown template and a lean `AGENTS.md` in the selected workspace. It only creates missing destinations and reports existing files as skipped, so rerunning setup preserves local instructions and configuration.

```sh
node bin/app setup --dry-run
node bin/app setup
```

To initialize another existing directory, run `node /absolute/path/to/bin/app --root /absolute/path/to/workspace setup`. The workspace root must exist. Setup does not install npm dependencies or silently upgrade existing application files; replace an existing bundle explicitly from a reviewed distribution.

## Independent library projects

Each managed project is a TypeScript library under `paths.projects`, default `projects`. Set that configuration value to `src` or another project-relative directory when preferred. Projects have their own build/test setup and a marker used for discovery; unrelated directories are not assumed to be managed projects.

```sh
node bin/app project list --json
node bin/app project create knowledge-core --dry-run
node bin/app project create knowledge-core
node bin/app project inspect knowledge-core --json
node bin/app project component knowledge-core WorkItem --kind domain --dry-run
node bin/app project component knowledge-core WorkItem --kind domain
node bin/app project component knowledge-core FindWorkItem --kind application
```

Use lowercase kebab-case project IDs and PascalCase component names. Project creation provides strict TypeScript, Vite, Vitest, domain/application/infrastructure boundaries and focused agent instructions. Components use the project's existing layout. Preview the generated source and adapt generic invariants and ports to the actual domain; a generated class is not a completed business feature.

The distributed Forge CLI requires only Node. Building and testing a generated TypeScript project uses its own development dependencies, including Oxlint 1.86.0 and fallow 3.31.0 native binaries. The scaffold does not install packages or fabricate a lockfile. Install from the project directory, review and commit the generated `package-lock.json`, then use `npm ci` for repeat installations and CI:

```sh
cd projects/knowledge-core # use your configured projects path
npm install
npm run check:fast
npm run check
```

`check:fast` runs lint, static analysis and type checking. The full `check` adds a build and tests. Static analysis checks unused code/dependencies and layer boundaries; `src/index.ts` is the intentional public API. Keep public exports narrow and retain meaningful behavioral coverage as the implementation grows.

For an agent, use this feedback loop:

1. Read the project `AGENTS.md`, README and scripts; establish acceptance examples before editing.
2. Make one focused change, add meaningful tests, and run `npm run check:fast`.
3. Diagnose each failure and fix its cause. Use `npm run lint` or `npm run analyze` for structured diagnostics; npm may also print its script banner, so read `.quality-reports/oxlint.json` and `.quality-reports/fallow.json`, or invoke `node scripts/quality/lint.mjs` and `node scripts/quality/analyze.mjs` directly to parse stdout.
4. Rerun the failed stage (`lint`, `analyze`, `typecheck`, `build` or `test`), then finish with `npm run check` from the project directory.
5. Review the diff and report the acceptance evidence, checks run and any unresolved failures. Do not delete coverage, broaden exclusions or suppress findings merely to pass a gate.

The Forge's repository checks validate the scaffold and distribution; they do not validate business behavior added later to a generated project. Run the selected project's own checks after scaffolding components or editing its code.

Project mutations use the same contained paths, collision checks, dry-run previews and post-commit events as other commands. They do not overwrite existing source files. Use `read`, guarded edits and the target project's toolchain for subsequent changes. Keep workspace and project AGENTS.md files brief: describe boundaries, actual commands and the evidence expected before delivery.
