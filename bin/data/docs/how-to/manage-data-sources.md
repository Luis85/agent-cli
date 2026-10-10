# Maintain data sources and integrate generated adapters

[Documentation](../index.md) · How-to guide

Use this guide to add REST/local-JSON contracts to an existing project, generate adapters and fixtures, and update them safely. For every schema field and supported operation, see the [data-source reference](../reference/data-sources.md). The [purchase-approval workflow](../examples/idea-to-production/README.md) supplies a filled-in REST [request view](../examples/idea-to-production/sources/purchase-requests.md) and local JSON [approver list](../examples/idea-to-production/sources/approvers.md).

## Add or import definitions

Create a starter and edit its YAML frontmatter and Markdown description:

```sh
node bin/forge.js data-sources create products --kind rest
node bin/forge.js data-sources create approvers --kind json
node bin/forge.js data-sources inspect products --json
node bin/forge.js data-sources validate
```

Alternatively, `data-sources init` adds examples of both kinds, or place your own `.md` files anywhere under the configured library directory. Each ID must be unique. Choose the model's identity field, declare every scalar field, list the REST operations the API actually implements, and add realistic synthetic examples. Keep unsupported business rules and transport details explicit in the Markdown description.

When working from this repository, import the worked examples into a separate shared library:

```sh
node bin/forge.js data-sources import --from docs/examples/idea-to-production/sources --library contracts/data --dry-run
node bin/forge.js data-sources import --from docs/examples/idea-to-production/sources --library contracts/data
node bin/forge.js data-sources validate --library contracts/data
node bin/forge.js data-sources list --library contracts/data
```

The following steps use those two imported definitions and an existing managed project named `portal`. Substitute your project ID. In the portable distribution, the same examples are bundled under `bin/data/docs/examples/idea-to-production/sources`; use that path for `--from`.

Shared definitions always live at workspace scope. Generic editing commands follow the active project, so close that selection before using `read`, `properties`, `edit` or `write` on a shared definition. Use the revision returned by the read/inspection when saving changes:

```sh
node bin/forge.js project close
node bin/forge.js read contracts/data/approvers.md --json
node bin/forge.js properties contracts/data/approvers.md --set '{"json":{"path":"data/approvers.json"}}' --if-match YOUR_REVISION --dry-run
```

Review the preview, then repeat without `--dry-run` to apply that edit if it matches your intended runtime location. Revalidate the library before generation.

## Choose output locations and generate

Configure the five `paths.dataSources`, `dataGenerated`, `dataFixtures`, `dataImports` and `dataExports` values in `bin/config.json`, or override the relevant paths per invocation. These commands explicitly select the project and both generated directories:

```sh
node bin/forge.js make data-source purchase-requests --library contracts/data --project portal --out src/data --test-data-out testdata/generated --dry-run
node bin/forge.js make data-source purchase-requests --library contracts/data --project portal --out src/data --test-data-out testdata/generated
node bin/forge.js make data-source approvers --library contracts/data --project portal --out src/data --test-data-out testdata/generated
```

Check response `context.root` before continuing. Both generated directories are relative to `portal`; the library remains workspace-relative. Each source produces a `.ts` adapter and `.fixtures.json` array. Generation does not install dependencies, contact the REST service or load the local JSON file.

The unmodified example JSON definition uses `testdata/generated/approvers.fixtures.json`, matching the fixture destination above. If you changed its `json.path`, either supply a real JSON file at that runtime location or override `path` during construction. Changing the fixture output directory alone does not change `json.path`.

## Use a REST adapter

In the consuming project, import the generated factory and provide the real endpoint at runtime. The example request-view definition declares only `get`:

```ts
import { createPurchaseRequestViewDataSource } from './data/purchase-requests.js';

export function requestViews(baseUrl: string, token: string) {
  return createPurchaseRequestViewDataSource({
    baseUrl,
    headers: { Authorization: `Bearer ${token}` },
  });
}

// In an authenticated application flow:
// const request = await requestViews(apiBaseUrl, accessToken).get(requestId);
```

The `.js` import is for normal TypeScript compilation to JavaScript; adapt it to your project's module convention. Pass tokens from the application's authentication layer. Inject `fetch` instead when the application needs request-specific credentials, token refresh or other transport behavior. Pass an `AbortSignal` as the last operation argument when canceling an in-flight request.

For create/update operations, check that the API accepts the generated model contract before declaring them. Create and PUT update require the complete model, including its ID; PATCH update accepts a partial model. All three reject unknown input fields. The sample approval workflow has domain-specific commands with separate payloads, so implement those in application code. UI event handlers call the appropriate use case or adapter; generating a data source does not automatically bind UI components.

## Read local JSON in Node or the browser

Local JSON adapters require a loader. This Node example anchors relative paths to the consuming project's working directory and reads the generated fixture explicitly:

```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDemoApproverDataSource } from './data/approvers.js';

const projectRoot = process.cwd();
const approvers = createDemoApproverDataSource({
  path: 'testdata/generated/approvers.fixtures.json',
  loadJson: async path => JSON.parse(await readFile(resolve(projectRoot, path), 'utf8')),
});

const records = await approvers.list();
const selected = await approvers.get('person_demo_pat');
```

Run this code with the consuming project as the working directory, or select an explicit application root. JSON loading is read-only; supplying a file path does not generate or modify that file.

In a browser, arrange for the application server/build to serve the JSON asset at a chosen URL, then provide a browser loader:

```ts
import { createDemoApproverDataSource } from './data/approvers.js';

const approvers = createDemoApproverDataSource({
  path: '/data/approvers.json',
  loadJson: async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Cannot load approvers: HTTP ${response.status}`);
    return response.json();
  },
});

const records = await approvers.list();
```

The runtime `path` override is interpreted by your loader. The generator does not copy a fixture into a public-assets directory or configure asset hosting. A fixture containing people or permissions is development data, not a production authorization source.

## Review changes and regenerate

After editing definitions, inspect the generated proposal using exactly the same source, project and output paths:

```sh
node bin/forge.js make data-source approvers --library contracts/data --project portal --out src/data --test-data-out testdata/generated --plan
node bin/forge.js make data-source approvers --library contracts/data --project portal --out src/data --test-data-out testdata/generated --plan-out reviews/approvers-revisions.json
```

Review every proposed change and reconcile handwritten edits before applying. The second command writes only a new revision-map file under the project; it does not replace the adapter or fixture. Existing map files are protected, so use a new filename for a new review.

```sh
node bin/forge.js make data-source approvers --library contracts/data --project portal --out src/data --test-data-out testdata/generated --revisions-from reviews/approvers-revisions.json --dry-run
node bin/forge.js make data-source approvers --library contracts/data --project portal --out src/data --test-data-out testdata/generated --revisions-from reviews/approvers-revisions.json
node bin/forge.js make data-source approvers --library contracts/data --project portal --out src/data --test-data-out testdata/generated --check
```

A stale revision stops the entire generation batch. Read the changed files and review a fresh plan; no force flag bypasses reconciliation. Use `--check` in CI to detect missing or changed generated output. It exits 5 with `DATA_SOURCE_DRIFT` when bytes differ.

Compile the generated adapters with your project's TypeScript setup and test actual behavior: request URL/method/body, authentication injection, error responses, malformed data, cancellation and local-file loading. Fixture generation and drift checking do not prove the external API contract or domain rules.

## Transfer definitions

```sh
node bin/forge.js data-sources export --library contracts/data --out exchange/data-sources --dry-run
node bin/forge.js data-sources export --library contracts/data --out exchange/data-sources
```

Import the exported folder into a different library or workspace using `data-sources import --from`. Transfers preserve nested Markdown paths and reject duplicate IDs or destination collisions. Runtime JSON files, credentials, handwritten transport wrappers and generated output must be managed separately.
