# Working on agent-cli

Read README.md and docs/architecture.md before making changes. Keep domain/application imports independent of Node and infrastructure. Inject ports; compose at src/main.ts. Commands must return JSON-serializable results and never prompt or print progress to stdout. New mutations must use workspace write orchestration, support dry-run, guard replacement with a revision, and emit events only after successful persistence.

Keep docs, help and bundled agent skills consistent with behavior. Run npm run check for implementation changes. bin/app is an intentional tracked distribution: rebuild and commit it with source. Tests must cover meaningful acceptance and failure behavior, especially plugin lifecycle, file integrity and portable execution. Do not claim Obsidian rendering or expression evaluation from structural format checks.
