# Develop and verify a change

[Documentation](../index.md) · How-to guide

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

## Develop the selected source project

Run the commands above from the repository root. Runtime source lives in `src/the-forge`; package/build configuration, tests, `scripts/` and `configs/` remain at the root. The checkout's tracked `bin/config.json` uses `paths.projects: "src"`, its `src/the-forge/.forge/project.json` marker registers the source project, and tracked `bin/data/context.json` selects `the-forge`. Confirm scope before using the bundled CLI:

```sh
node bin/app.js project current --json
node bin/app.js project open the-forge
node bin/app.js read README.md --json
node bin/app.js make entity SourceProbe --out domain/example --dry-run
```

These file paths resolve under `src/the-forge`. Specify a layer/concern output for self-generation: the normal `src/domain` generator default would create `src/the-forge/src/domain`. `project close` explicitly returns file commands to the repository root; reopen `the-forge` to resume source work. Setup and builds preserve the saved selection, including an intentional closed selection. Release packaging restores generic configuration and omits the checkout selection in the archive.

The repository's `configs/quality/source.json` declares `sourceRoot: "src/the-forge"` and `additionalRoots: ["docs/examples", "docs/templates"]`. Source inventory, lint and analysis include Forge source and authored asset code rather than all sibling managed projects in `src`. This quality policy is independent of the CLI's selected project. Run another project's own checks from its directory. Portable generated projects without this policy continue to use their ordinary `src` source root.

## Showcase drift check

`src/forge-showcase` is a committed, fully generated example project; see [explore the showcase](explore-the-showcase.md). `npm run showcase:check` regenerates it into a temporary workspace through the current `bin/app.js` and lists every differing path; it never modifies the checkout. The end-to-end test `tests/showcase/showcase.e2e.test.ts` runs the same check (about 45 seconds alone, up to about 90 seconds under the full parallel suite) and also queries its Bases, validates its Canvas and checks UI and adapter drift through the CLI. When a change alters generated output, rebuild, run `npm run showcase`, review the showcase diff and commit it with the change. Forge's quality inventory excludes the showcase; run its own `npm ci` and `npm run check` from `src/forge-showcase` when its toolchain or generated code changes.

## Agent feedback loop

Read `AGENTS.md`, establish acceptance examples and inspect the affected boundary. After a focused edit, run the relevant behavioral test and `npm run check:fast`. This gate runs structure validation first, then Oxlint, fallow and the TypeScript compiler without rebuilding the distribution. Static analysis complements tests; a clean report does not prove business behavior or filesystem integrity. Analysis includes test entry points, so code referenced only by tests counts as used; this is not proof of production reachability.

| Stage | Purpose | Focused command |
| --- | --- | --- |
| Structure | Test-pyramid labels/locations and Forge source layout | `npm run check:structure` |
| Lint | Correctness, source conventions and code-line limits | `npm run lint` |
| Analyze | Unused code/dependencies and architecture boundaries | `npm run analyze` |
| Typecheck | Strict TypeScript contracts in source and tests | `npm run typecheck` |
| Build | Bundle runtime dependencies, declarations and assets | `npm run build` |
| Test | Behavioral, integration and portable distribution checks | `npm test` |

`npm run lint` and `npm run analyze` emit JSON diagnostic envelopes with `tool`, `ok` and `errors`, plus `scope` and the underlying tool `report` when available. The same reports are saved to `.quality-reports/oxlint.json` and `.quality-reports/fallow.json` (ignored by Git). Reports identify the configured scope; the wrappers reject mismatched file inventories; fallow also rejects an unexpected report version/schema or missing required checks so an accidentally empty scan cannot pass. When consuming the output programmatically, invoke the wrapper directly (`node scripts/quality/lint.mjs`, `node scripts/quality/analyze.mjs`) to avoid npm's script banner. Read the report from the command just executed; later stages may not have run after an earlier failure. A nonzero exit status requires investigation; an empty or malformed report is not evidence of success.

Fix the cause of each failure and rerun its stage before proceeding. Keep changes focused; do not suppress findings, widen analyzer entry points or delete tests just to make a command green. If a dynamic plugin contract creates a real false positive, document the specific contract and use the narrowest justified configuration. The plugin SDK is a public entry point even when the CLI itself does not import every SDK export.

After the targeted checks pass, run `npm run check` once as the final gate. It rebuilds before running the complete test suite, so CLI tests exercise current source. Review source and bundle diffs together and report the commands run, acceptance examples exercised, affected concerns/ranks and unresolved failures. Review evidence should distinguish source-level tests, filesystem/process integration, standalone distribution workflows and downstream framework verification. For generated projects, run that project's scripts from its directory; the Forge repository's passing checks do not validate downstream business code. See [project feedback](manage-projects.md).

## Verification

Tests are grouped by concern under `tests/<concern>/`: architecture, CLI, data sources, distribution, documentation, documents, forms, generation, plugins, projects, quality, showcase, templates, UI and workspace. The repository's `tests/README.md` indexes those boundaries. Keep helpers shared across concerns in `tests/support`; place concern-specific fixtures near their consumers. Directory grouping describes ownership; filename suffixes describe verification scope.

Every test has an explicit pyramid rank in its filename and runs in the matching named Vitest project:

| Layer | Filename | Scope | Focused command |
| --- | --- | --- | --- |
| Unit | `*.unit.test.ts` | Isolated domain/parser/codec behavior | `npm test -- --project unit` |
| Integration | `*.integration.test.ts` | Collaborating services, adapters and quality boundaries | `npm test -- --project integration` |
| End-to-end | `*.e2e.test.ts` | Bundled CLI and extracted-release workflows | `npm test -- --project e2e` |

Put most behavioral cases in focused unit tests, test real boundaries with integration tests, and keep end-to-end cases for complete workflows. Choose the layer by what a test exercises, including when splitting pure parser/graph assertions away from filesystem or lifecycle integration tests. A concern folder can contain multiple ranks. Run `npm run build` before tests that execute the bundle; the full `check` does this automatically.

`npm run lint` uses Oxlint's `max-lines` rule with `skipBlankLines` and `skipComments` to enforce **400 code-bearing lines per authored source file** and **450 per test file or test-support file under `tests/`**. Blank and comment-only lines are excluded; lines containing both code and comments count. The inventory covers authored JavaScript/TypeScript in configured `src/the-forge`, `docs/examples` and `docs/templates`, plus `scripts`, `tests` and root configuration files. Generated `bin` artifacts are excluded. When approaching a limit, extract a cohesive responsibility or split tests by behavior; do not compress statements, remove useful comments or rename files just to evade a limit. Line-limit findings appear in `.quality-reports/oxlint.json`.

`npm run check:structure` checks test-pyramid suffixes, requires tests under `tests/`, and enforces Forge's `src/the-forge/<layer>/<concern>/` layout. It saves `.quality-reports/structure.json` using the same diagnostic envelope as lint/analysis. Use `node scripts/quality/structure.mjs --source-layout forge` for JSON stdout without npm's banner. The generated-project copy runs without that switch and keeps its own scaffold layout. See the source repository’s `src/the-forge/README.md` for placement rules. The TypeScript gate uses the official `tsc` compiler for application source and an explicit inventory of all test/support files, including hidden paths and JavaScript with `allowJs`/`checkJs`. This avoids files being silently omitted by compiler globs. Passing Vitest execution alone does not replace type checking.

Vitest exercises Canvas invariants, YAML/frontmatter preservation, optimistic revisions, no-write previews, path and symlink rejection, batch collision preflight, event delivery/lifecycle, and the standalone JSON protocol. End-to-end tests copy the bundle to a temporary directory without `node_modules` and invoke it through Node. Every accepted attachment extension gets a binary round-trip test; these tests establish byte fidelity, not media codec validity. Tests also load an external runtime plugin from the copied bundle. An architecture test rejects infrastructure or Node imports in domain/application code.

Generated boilerplate must be reviewed and tested in its destination project. Domain scaffolds include generic identity/value validation; application scaffolds demonstrate dependency injection. They do not implement inferred business requirements.

## Adding behavior

1. Define the observable contract and acceptance cases, including errors.
2. Put invariants in domain code and orchestration in an application service with injected ports.
3. Implement adapters and register commands in the presentation catalog. Add a generator or runtime plugin when that is the appropriate extension point.
4. Cover meaningful behavior and integration boundaries. Update help, docs and relevant agent skills.
5. Diagnose and fix failed checks, rerun the failed stage, then run `npm run check`. Review the source and rebuilt artifact diff and commit both.

No global dependency container, Obsidian process or npm runtime installation is required. Prefer explicit collaborators and domain terms over generic helper layers.

## Platform matrix

GitHub Actions runs the full gate (`npm ci`, then `npm run check`) on every push and pull request:

| Runner | Node | Additional steps |
| --- | --- | --- |
| `ubuntu-latest` | 22.12.0, 24 | Verifies that the committed `bin/` matches the fresh build, then builds and uploads the release archive |
| `windows-latest` | 22.12.0, 24 | Runs steps in Git Bash and puts Git's GNU tar first on `PATH` |
| `macos-latest` | 22.12.0, 24 | Puts Homebrew's GNU tar (`gnubin`) first on `PATH` |

The committed bundle is the Linux build. Windows and macOS verify behavior, not identical bundle bytes. Workflow actions are pinned to full commit SHAs.

`.gitattributes` checks out text files with LF line endings on every platform, regardless of `core.autocrlf`, and marks media and archive types as binary. Revisions hash raw bytes, so a checkout that converted line endings would change every revision and break byte comparisons between packaged and source files.

Keep tests portable:

- Build expected OS paths with `node:path` (`join`, `basename`), and pass POSIX workspace paths (`notes/a.md`) to the CLI and repository ports.
- The CLI reports canonical roots (`realpath`). Canonicalize temporary directories before comparing them, because macOS `/var` links to `/private/var` and Windows can report 8.3 short names. `tests/support/portable-cli.ts` already does this.
- Start npm through a shell (`exec('npm run ...')`). On Windows, npm is a `.cmd` shim that Node only starts through a shell.
- Use `'junction'` when linking `node_modules` into fixtures. Junctions need no symlink privilege on Windows, and other platforms ignore the type. Symlink-rejection tests still create real symlinks, which the Windows runners allow.
- Run `tar` with relative paths from a working directory. GNU tar reads `C:\...` as a remote host name.
- Do not assume POSIX permission bits, signals or process groups. Windows reports writable files as `0o666`. Skip a test on `win32` only when the behavior it checks cannot exist there, and give the reason in a comment. The current skips are the Claude runtime signal and process-group cases and the installed-lifecycle fixture that executes a script through its shebang.
- macOS and Windows file systems are case-insensitive by default. Detect case sensitivity at runtime when a test depends on it, as `tests/workspace/portability.integration.test.ts` does.

`npm test` raises Vitest's default test and hook timeouts to 30 seconds, because creating processes on Windows runners is much slower than on Linux.

For publishing a validated distribution archive, see [build a release](release.md).
