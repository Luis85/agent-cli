# Test concerns and pyramid levels

Tests live under the concern they verify. Every executable test file declares its pyramid level in its filename; shared support files do not use a `.test` or `.spec` suffix. Tests for a bundled core plugin live in `tests/<plugin-id>/`.

| Concern | Coverage |
| --- | --- |
| [architecture](architecture/) | Kernel layer boundaries, core plugin layering (no plugin-to-plugin or plugin-to-kernel-adapter imports) and the SDK |
| [bases](bases/) | The `bases` core plugin: standalone native Bases filters, formulas, file metadata, metadata-cache adaptation, portable repository queries, query scaling and disabling it through `plugins.disabled` |
| [backlog](backlog/) | The `backlog` core plugin: backlog-view conformance fixtures, settings, model, ranks, writes, releases, the CLI workflow, and the sync engine (three-way field decisions, sync state, push/pull/conflict/resolve against the Azure DevOps fake, portable sync) |
| [connector](connector/) | The `connector` core plugin: connection profiles and their validation, the connectors hub, token handling and redaction, and the kernel HTTP transport (retries, Retry-After, timeouts) |
| [connector-azure-devops](connector-azure-devops/) | The `connector-azure-devops` core plugin: process mappings, JSON Patch documents, work item reading, Markdown to HTML, and the connector against the in-process Azure DevOps fake (`support/azure-devops.ts`) |
| [cli](cli/) | Argument parsing, command metadata and its JSON Schema, metadata-driven invocation policy, discovery, errors, and input routing |
| [claude](claude/) | Native agents, hooks, plugin assets, guarded removal and installed CLI invocation |
| [data-sources](data-sources/) | Definition validation, generated adapters, CRUD behavior, and portable workflows |
| [distribution](distribution/) | Packaging, release archives, checksums, and standalone execution |
| [documentation](documentation/) | Source and packaged navigation, and executable worked examples |
| [documents](documents/) | Markdown, Canvas, Bases, guarded edits, and attachment integrity |
| [forms](forms/) | Form validation and browser rendering |
| [generation](generation/) | Scaffold contracts, review plans, revision manifests, and guarded writes |
| [interactions](interactions/) | Declarative event/action schemas, component attachment, generated behavior, and portable workflows |
| [metadata](metadata/) | Kernel metadata cache parsing, link resolution, shortest link text, backlinks, incremental updates against full rebuilds and post-commit metadataCache events |
| [plugins](plugins/) | Plugin lifecycle, contract v2 (services, config sections, strings, error codes, core plugin registration), generators and events |
| [search](search/) | The `search` core plugin: literal and regular-expression matching, scopes, metadata filters, paging, the matching time budget and its CLI contract |
| [links](links/) | The `links` core plugin: link reports over the metadata cache (out, back, unresolved, orphans with roots, dead ends) and its CLI contract |
| [agents](agents/) | The `agents` core plugin: docker-agent conformance over the pinned examples (`fixtures/docker-agent`, copied with attribution by `npm run vendor:docker-agent`), semantic rules, codecs, the Claude mapping per concept, golden generation files (`golden/`, rewritten with `UPDATE_GOLDEN=1`), generation with merges and drift, authoring and import, and its CLI contract |
| [skills](skills/) | The `skills` core plugin: listing, installation, and disabling it through `plugins.disabled` |
| [projects](projects/) | Project creation, generated project toolchains, and persistent selection |
| [quality](quality/) | Lint, analysis, classification, discovery, and TypeScript gate behavior |
| [showcase](showcase/) | Committed showcase regeneration without drift, vault links, Canvas/Bases queries and generated UI/adapters |
| [templates](templates/) | Template rendering, required inputs, planning-pack installation, and project workflows |
| [ui](ui/) | Component definitions, composition, renderers, Storybook, real framework compilation, and CLI workflows |
| [vault](vault/) | Link rewriting for moves, guarded move/rename/delete through the kernel file manager, the `app` facade and portable move/delete workflows |
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
