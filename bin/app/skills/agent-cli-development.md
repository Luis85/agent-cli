---
name: agent-cli-development
description: Generate and extend TypeScript features with explicit domain boundaries and evidence of correctness.
---

1. Define the domain language, acceptance examples, invariants, and dependencies before generating code.
2. Discover available generators with `node bin/app make --json`. Use PascalCase names and explicit destinations, for example `make entity WorkItem --out src/domain --dry-run` or `make use-case FindWorkItem --out src/application --dry-run`.
3. Review the generated source, apply the command, and replace generic behavior with the actual domain rules. Scaffolds are starting points, not completed features.
4. Keep domain code independent of Node, plugins, CLI parsing and storage. Application services orchestrate injected ports. Infrastructure implements ports. The composition root owns wiring and lifecycle.
5. Test observable behavior: invalid state, success, failure, stale writes, and important edge cases. Run the project's type checker and relevant tests. Add integration tests where serialization or filesystem behavior matters.
6. For a plugin, run `make plugin MyTools --out plugins`; review the emitted `.mjs`, add its project-relative path to the explicit plugin manifest, and invoke commands with `--plugins agent-cli.plugins.json`. Namespace commands, generators, skills and events under the plugin ID. Use `context.workspace.write` so guards, dry-run and events apply. Return an async cleanup function from activate when resources need disposal. Never log to stdout; return serializable data.
7. For changes to agent-cli itself, run `npm ci`, `npm run check`, update docs and skills, rebuild and commit `bin/app` with the source. Use `npm run release` for a downloadable archive. Do not ship a stale bundle.
