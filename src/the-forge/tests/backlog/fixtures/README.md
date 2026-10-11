# backlog-view conformance fixtures

`vault/` holds files copied unchanged from [Luis85/backlog-view](https://github.com/Luis85/backlog-view) at commit `fb813df` (plugin id `product-backlog-view`, version 0.10.0 plus the unreleased global rank on `main`): the plugin's own `docs/Product Backlog.base` with its four view types, and a representative set of notes from its `docs/` folder that the plugin and its maintainer wrote (Epics, Features, PBIs, Tasks, a test suite and test case, two releases and three resources). Parents and dependencies that point at notes outside this subset stay unresolved on purpose; they exercise orphans and broken dependencies.

`expected/` holds notes derived by hand from backlog-view's `storage/createNote.ts` (`createBacklogItem`, `createRelease`), `domain/rankArithmetic.ts` and `domain/releaseNotesText.ts` for operations on that vault. `tests/backlog/conformance.integration.test.ts` compares Forge's output with them byte for byte.

The copied files are used under the MIT License of backlog-view; see [LICENSE-backlog-view](LICENSE-backlog-view):

> MIT License — Copyright (c) 2026 Luis85

Refresh the fixtures from a newer plugin commit when the plugin changes its on-disk contract, and record the commit here.
