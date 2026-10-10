# Test concerns and pyramid levels

Tests live under the concern they verify. Every executable test file declares its pyramid level in its filename; shared support files do not use a `.test` or `.spec` suffix.

| Concern | Coverage |
| --- | --- |
| [architecture](architecture/) | Domain and application import boundaries |
| [bases](bases/) | Standalone native Bases filters, formulas, file metadata, link resolution, portable repository queries and query scaling |
| [cli](cli/) | Argument parsing, discovery, errors, and input routing |
| [claude](claude/) | Native agents, hooks, plugin assets, guarded removal and installed CLI invocation |
| [data-sources](data-sources/) | Definition validation, generated adapters, CRUD behavior, and portable workflows |
| [distribution](distribution/) | Packaging, release archives, checksums, and standalone execution |
| [documentation](documentation/) | Source and packaged navigation, and executable worked examples |
| [documents](documents/) | Markdown, Canvas, Bases, guarded edits, and attachment integrity |
| [forms](forms/) | Form validation and browser rendering |
| [generation](generation/) | Scaffold contracts, review plans, revision manifests, and guarded writes |
| [interactions](interactions/) | Declarative event/action schemas, component attachment, generated behavior, and portable workflows |
| [plugins](plugins/) | Plugin lifecycle, generators, events, and skill installation |
| [projects](projects/) | Project creation, generated project toolchains, and persistent selection |
| [quality](quality/) | Lint, analysis, classification, discovery, and TypeScript gate behavior |
| [showcase](showcase/) | Committed showcase regeneration without drift, vault links, Canvas/Bases queries and generated UI/adapters |
| [templates](templates/) | Template rendering, required inputs, planning-pack installation, and project workflows |
| [ui](ui/) | Component definitions, composition, renderers, Storybook, real framework compilation, and CLI workflows |
| [workflows](workflows/) | Project workflow discovery, YAML scoping, guarded synchronization, drift checks and the checkout's generated workflows |
| [workspace](workspace/) | Configuration, filesystem boundaries, revision guards, scoping, and installation |
| [support](support/) | Shared fixtures, including the copied portable CLI harness and the workspace distribution location |

Choose the level from the boundary exercised:

- `*.unit.test.ts`: isolated deterministic behavior, such as argument parsing, definition codecs, graph validation, emitted source, and form model rules. These tests do not require real filesystems or complete applications. Using a parsing library inside the unit does not by itself make a test an integration test.
- `*.integration.test.ts`: collaborating boundaries, including filesystem orchestration, configuration loading, plugin activation, emitted code compiled by real framework toolchains, and quality tools operating on fixture repositories.
- `*.e2e.test.ts`: complete public workflows through a copied CLI or release artifact, with real process invocation and observable files and JSON responses.

Keep isolated codec assertions separate from filesystem lifecycle suites. Framework compatibility tests belong to integration even when their inputs are small; asserting emitted text alone is unit coverage. Avoid changing a label merely to change pyramid counts. Prefer many focused unit cases, fewer boundary tests, and a small set of complete workflows.

Run commands from the Forge project directory `src/the-forge`. Tests that need the built distribution, the showcase or the checkout's generated workflows locate the workspace through `support/workspace.ts`, which reads `config.distribution` from `package.json`:

```sh
npm test -- --project unit
npm test -- --project integration
npm test -- --project e2e
npm test -- tests/ui
npm test -- tests/ui/definitions.unit.test.ts
npm run check:fast
npm run check
```

The full gate builds the distribution before tests. Portable CLI and packaged-document tests need that current build; when running them directly after source or documentation changes, run `npm run build` first. Unit and integration tests that only read source do not require a distribution rebuild.

Vitest discovers classified files recursively, including nested concern directories. The structure gate rejects unclassified tests and tests outside `tests/`; TypeScript checks every discovered test and support file. Keep source and test code limits enforced by the existing quality gates. Shared fixtures belong in `support/` or a concern-specific support module, with an ordinary source filename rather than an unranked test filename.
