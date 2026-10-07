# Development and distribution

Use Node >=22.12, npm and GNU tar (needed by archive tests and release packaging). `npm ci` installs locked development dependencies, including Oxlint 1.86.0 and the Rust-based fallow 3.31.0 analyzer. Their platform-specific native binaries are development tools; installation requires a supported OS/architecture and npm optional dependencies. Do not use `--omit=optional`. No Rust toolchain is needed for the prebuilt npm packages. Runtime libraries include Commander for CLI parsing, Zod for configuration, unified/remark for Markdown structure, YAML for document codecs, and Day.js for template dates. Vite includes them in the executable; Node standard-library modules remain external. The release runs in both ESM and CommonJS parent projects because `bin/package.json` sets `type: commonjs` for `bin/app.js`; keep both files together. Packaging copies direct and transitive runtime dependency licenses and generates `THIRD-PARTY-NOTICES.md` from the lockfile.

```sh
npm ci
# quick feedback while changing code
npm run check:fast
# all quality checks, a fresh bundle, and the complete test suite
npm run check
# full validation, then release archive and SHA-256 checksum
npm run release
```

`npm test` expects `bin/app.js` to have been built. After changing CLI source, run `npm run build` before focused bundle/integration tests; source-level unit tests can run directly. `npm run dev` watches and rebuilds the executable with Vite while retaining other bundle files; it does not refresh packaged documentation, SDK declarations, licenses or configuration. `npm run build` refreshes the complete distribution. Use the full build before testing release behavior, distributing or committing artifacts.

## Agent feedback loop

Read `AGENTS.md`, establish acceptance examples and inspect the affected boundary. After a focused edit, run the relevant behavioral test and `npm run check:fast`. This gate runs structure validation first, then Oxlint, fallow and the TypeScript compiler without rebuilding the distribution. Static analysis complements tests; a clean report does not prove business behavior or filesystem integrity. Analysis includes test entry points, so code referenced only by tests counts as used; this is not proof of production reachability.

| Stage | Purpose | Focused command |
| --- | --- | --- |
| Structure | Test-pyramid labels and locations | `npm run check:structure` |
| Lint | Correctness, source conventions and code-line limits | `npm run lint` |
| Analyze | Unused code/dependencies and architecture boundaries | `npm run analyze` |
| Typecheck | Strict TypeScript contracts in source and tests | `npm run typecheck` |
| Build | Bundle runtime dependencies, declarations and assets | `npm run build` |
| Test | Behavioral, integration and portable distribution checks | `npm test` |

`npm run lint` and `npm run analyze` emit JSON diagnostic envelopes with `tool`, `ok` and `errors`, plus `scope` and the underlying tool `report` when available. The same reports are saved to `.quality-reports/oxlint.json` and `.quality-reports/fallow.json` (ignored by Git). Reports identify the configured scope; the wrappers reject mismatched file inventories; fallow also rejects an unexpected report version/schema or missing required checks so an accidentally empty scan cannot pass. When consuming the output programmatically, invoke the wrapper directly (`node scripts/quality/lint.mjs`, `node scripts/quality/analyze.mjs`) to avoid npm's script banner. Read the report from the command just executed; later stages may not have run after an earlier failure. A nonzero exit status requires investigation; an empty or malformed report is not evidence of success.

Fix the cause of each failure and rerun its stage before proceeding. Keep changes focused; do not suppress findings, widen analyzer entry points or delete tests just to make a command green. If a dynamic plugin contract creates a real false positive, document the specific contract and use the narrowest justified configuration. The plugin SDK is a public entry point even when the CLI itself does not import every SDK export.

After the targeted checks pass, run `npm run check` once as the final gate. It rebuilds before running the complete test suite, so CLI tests exercise current source. Review source and bundle diffs together and report the commands run, acceptance evidence and unresolved failures. For generated projects, run that project's scripts from its directory; the Forge repository's passing checks do not validate downstream business code. See [project feedback](projects.md).

## Verification

Tests follow the pyramid and use explicit filenames and named Vitest projects:

| Layer | Filename | Scope | Focused command |
| --- | --- | --- | --- |
| Unit | `*.unit.test.ts` | Isolated domain/parser/codec behavior | `npm test -- --project unit` |
| Integration | `*.integration.test.ts` | Collaborating services, adapters and quality boundaries | `npm test -- --project integration` |
| End-to-end | `*.e2e.test.ts` | Bundled CLI and extracted-release workflows | `npm test -- --project e2e` |

Put most behavioral cases in focused unit tests, test real boundaries with integration tests, and keep end-to-end cases for complete workflows. Choose the layer by what a test exercises. Run `npm run build` before tests that execute the bundle; the full `check` does this automatically.

`npm run lint` uses Oxlint's `max-lines` rule with `skipBlankLines` and `skipComments` to enforce **400 code-bearing lines per authored source file** and **450 per test file or test-support file under `tests/`**. Blank and comment-only lines are excluded; lines containing both code and comments count. The inventory covers authored JavaScript/TypeScript in `src`, `tests`, `scripts`, `examples` and root configuration files. Generated `bin` artifacts are excluded. When approaching a limit, extract a cohesive responsibility or split tests by behavior; do not compress statements, remove useful comments or rename files just to evade a limit. Line-limit findings appear in `.quality-reports/oxlint.json`.

`npm run check:structure` checks test-pyramid suffixes and requires tests under `tests/` so Vitest discovers them. It saves `.quality-reports/structure.json` using the same diagnostic envelope as lint/analysis. Use `node scripts/quality/structure.mjs` for JSON stdout without npm's banner. The TypeScript gate uses the official `tsc` compiler for application source and an explicit inventory of all test/support files, including hidden paths and JavaScript with `allowJs`/`checkJs`. This avoids files being silently omitted by compiler globs. Passing Vitest execution alone does not replace type checking.

Vitest exercises Canvas invariants, YAML/frontmatter preservation, optimistic revisions, no-write previews, path and symlink rejection, batch collision preflight, event delivery/lifecycle, and the standalone JSON protocol. End-to-end tests copy the bundle to a temporary directory without `node_modules` and invoke it through Node. Every accepted attachment extension gets a binary round-trip test; these tests establish byte fidelity, not media codec validity. Tests also load an external runtime plugin from the copied bundle. An architecture test rejects infrastructure or Node imports in domain/application code.

Generated boilerplate must be reviewed and tested in its destination project. Domain scaffolds include generic identity/value validation; application scaffolds demonstrate dependency injection. They do not implement inferred business requirements.

## Artifact policy

The executable, support manifest, default configuration and packaged assets in `bin` are deliberately version controlled. Local `bin/data/context.json`, installed plugins and workspace templates are runtime data. Builds refresh distribution assets without replacing local configuration, plugins, templates or project selection. Every source/skill/doc change affecting the release must rebuild the app. CI runs the same structure, lint, analysis, type checking, build and test gates, then rejects differences in the distribution, including untracked files. CI runs the suite on the minimum supported Node 22.12.0 and Node 24. The workflow uploads diagnostic reports even when a check fails and creates a downloadable build artifact after success; it does not publish a GitHub release automatically.

The release script requires **GNU tar** on the maintainer's path as `tar` and creates `release/forge-<version>.tar.gz` plus a SHA-256 checksum file. On macOS, install GNU tar and put its `gnubin` directory on `PATH`. The script checks agreement between source, bundle manifest and executable versions, and normalizes timestamps, ownership, permissions and entry order so unchanged content produces an identical archive. Archive tests verify the checksum and reproducibility, extract into a project without `node_modules`, and execute initialization and generation from the extracted app.

The archive contains `bin/app.js`, `bin/package.json`, default `bin/config.json`, empty plugin/template directories and packaged assets under `bin/data`. It excludes local context, installed plugins and workspace templates. `setup` creates the initial template. Project selection is saved separately by `project open`/`close`. End users extract it into a new project and run `node bin/app.js`; standard tar extractors can read the archive. They do not need tar after extraction, npm packages, TypeScript, Vite or Vitest to run the app. For an existing installation, extract separately and preserve configuration, shared plugins/templates and local context while replacing the executable and packaged assets. A checksum detects transfer corruption; obtain the archive and checksum from a trusted release source.

## Adding behavior

1. Define the observable contract and acceptance cases, including errors.
2. Put invariants in domain code and orchestration in an application service with injected ports.
3. Implement adapters and register commands in the presentation catalog. Add a generator or runtime plugin when that is the appropriate extension point.
4. Cover meaningful behavior and integration boundaries. Update help, docs and relevant agent skills.
5. Diagnose and fix failed checks, rerun the failed stage, then run `npm run check`. Review the source and rebuilt artifact diff and commit both.

No global dependency container, Obsidian process or npm runtime installation is required. Prefer explicit collaborators and domain terms over generic helper layers.
