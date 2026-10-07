# Development and distribution

Use Node >=22.12 and npm. `npm ci` installs locked development dependencies. The runtime's only library dependency, YAML, is included in the Vite bundle; Node standard-library modules remain external. The release runs in both ESM and CommonJS parent projects because its entry point is explicitly `.cjs`.

```sh
npm run typecheck
npm run build
npm test
# all of the above, in order
npm run check
# validate and produce release archive plus SHA-256 checksum
npm run release
```

`npm test` expects `bin/app` to have been built. `npm run dev` watches and rebuilds the executable with Vite; `npm run build` also refreshes the package manifest, SDK declarations, docs, skills and licenses. Use the full build before distributing or committing artifacts.

## Verification

Vitest exercises Canvas invariants, YAML/frontmatter preservation, optimistic revisions, no-write previews, path and symlink rejection, batch collision preflight, event delivery/lifecycle, and the standalone JSON protocol. Integration tests copy the bundle to a temporary directory without `node_modules` and invoke it through Node. Every accepted attachment extension gets a binary round-trip test; these tests establish byte fidelity, not media codec validity. Tests also load an external runtime plugin from the copied bundle. An architecture test rejects infrastructure or Node imports in domain/application code.

Generated boilerplate must be reviewed and tested in its destination project. Domain scaffolds include generic identity/value validation; application scaffolds demonstrate dependency injection. They do not implement inferred business requirements.

## Artifact policy

`bin/app` is deliberately version controlled. Every source/skill/doc change affecting the release must rebuild it. CI runs type checking, build and tests, then rejects differences in `bin/app`, including untracked files. CI runs the suite on Node 22 and 24. The workflow creates a downloadable build artifact; it does not publish a GitHub release automatically.

The release script uses the maintainer's `tar` executable and creates `release/agent-cli-<version>.tar.gz` plus a SHA-256 checksum file. End users extract the archive into a project and run `node bin/app`. They do not need tar after extraction, npm packages, TypeScript, Vite or Vitest to run the app.

## Adding behavior

1. Define the observable contract and acceptance cases, including errors.
2. Put invariants in domain code and orchestration in an application service with injected ports.
3. Implement adapters and register commands in the presentation catalog. Add a generator or runtime plugin when that is the appropriate extension point.
4. Cover meaningful behavior and integration boundaries. Update help, docs and relevant agent skills.
5. Run `npm run check`, review the diff, rebuild/review the bundled artifact, and commit both.

No global dependency container, Obsidian process or npm runtime installation is required. Prefer explicit collaborators and domain terms over generic helper layers.
