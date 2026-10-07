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

The distributed Forge CLI requires only Node. Building and testing a generated TypeScript project requires installing that project's development dependencies using its package manager. Follow the generated project README and package scripts, run the type checker and tests, and retain meaningful behavioral coverage as the implementation grows.

Project mutations use the same contained paths, collision checks, dry-run previews and post-commit events as other commands. They do not overwrite existing source files. Use `read`, guarded edits and the target project's toolchain for subsequent changes. Keep workspace and project AGENTS.md files brief: describe boundaries, actual commands and the evidence expected before delivery.
