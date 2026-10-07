# Data-source definition and adapter reference

[Documentation](../index.md) · Reference

A data source is a Markdown file with strict YAML frontmatter. Its body documents the contract; generation never executes the prose or contacts the source. The library supports REST APIs and local JSON files. See [manage data sources](../how-to/manage-data-sources.md) for generation, runtime integration and regeneration steps.

## Commands and paths

```text
data-sources [list | init | inspect <id> | validate]
data-sources create <id> [--kind rest|json]
data-sources import [--from directory]
data-sources export [--out directory]
make data-source <id> [--library directory] [--project id]
  [--out directory] [--test-data-out directory]
  [--plan | --plan-out file.json | --check]
  [--revisions-from file.json] [--dry-run]
```

Every `data-sources` action accepts `--library`. `create` defaults to `rest`. `init` adds `example-rest` and `example-json`, preserving existing definitions with those IDs. Discovery recursively reads `.md` files, validates every definition and rejects duplicate IDs. `inspect` returns the definition, its source path, Markdown description and the revision of that same file snapshot. `list` returns compact metadata. Import/export preserve exact Markdown bytes and nested paths; they transfer definitions only, and never overwrite existing files.

| Purpose | Configuration key | Default | Command override | Scope |
| --- | --- | --- | --- | --- |
| Definitions | `paths.dataSources` | `data-sources` | `--library` | Workspace |
| Generated adapters | `paths.dataGenerated` | `src/data-sources` | `make data-source --out` | Active project, otherwise workspace |
| Generated fixtures | `paths.dataFixtures` | `test-data` | `make data-source --test-data-out` | Active project, otherwise workspace |
| Import source | `paths.dataImports` | `imports/data-sources` | `data-sources import --from` | Workspace |
| Export destination | `paths.dataExports` | `exports/data-sources` | `data-sources export --out` | Workspace |

Configure these keys in `bin/config.json`; see [configuration](configuration.md). Paths must be contained relative POSIX paths, with no traversal or reserved workspace segments. The source's `json.path` is a separate runtime input to the application's loader. It is neither the definition directory nor an instruction to write a file. `--plan-out` is also configurable per invocation and writes its revision-map file in the active output scope.

## Frontmatter schema, version 1

Unknown fields are rejected at every declared object boundary. Definitions may contain these top-level fields:

| Field | Contract |
| --- | --- |
| `schemaVersion` | Required literal `1` |
| `id` | Required lowercase kebab-case ID, starting with a letter, maximum 120 characters; unique in the library |
| `kind` | Required `rest` or `json` |
| `model` | Required object with `name`, `fields`, optional `idField` |
| `rest` | Required only for `kind: rest`; forbidden for JSON |
| `json` | Required only for `kind: json`; forbidden for REST |
| `testData` | Optional fixture-generation settings |
| Markdown body | Uninterpreted documentation; retained during transfers |

`model.name` is a generated TypeScript name matching `[A-Z][A-Za-z0-9]*`. `model.fields` is a nonempty map of safe JavaScript identifiers to field declarations. `model.idField` defaults to `id` and must name a required, non-nullable string or number field. Reserved identifiers such as `constructor`, `prototype`, `__proto__`, `class` and `undefined` are rejected as field names.

Each field has required `type: string | number | boolean`, plus optional `optional`, `nullable`, `enum` and `example`. Both flags default to false. Numbers must be finite. An enum contains 1–100 unique scalar values matching the field type and nullability. An example must match the field and, when present, its enum. `null` therefore needs `nullable: true` and must appear in an enum if that field has one. ID examples, enum values and fixture IDs cannot be empty strings, `.` or `..`.

Version 1 has no nested records, arrays as model fields, dates, integer/range rules, per-operation input models or arbitrary validation expressions. Describe business invariants in the Markdown body and implement them in application/domain code.

## REST configuration

```yaml
rest:
  baseUrl: https://api.example.test/v1
  operations:
    list: { method: GET, path: /products, responsePath: data.items }
    get: { method: GET, path: '/products/{id}' }
    create: { method: POST, path: /products }
    update: { method: PATCH, path: '/products/{id}' }
    delete: { method: DELETE, path: '/products/{id}' }
```

At least one operation is required. Only declared operations become adapter methods. `baseUrl` must be HTTP(S), without embedded credentials, query or fragment. Each operation path starts with a single `/`; it cannot contain traversal, whitespace, a query, a fragment, malformed URL escapes or encoded traversal. Operation paths append to the base URL's pathname: the example above requests `/v1/products`.

| Operation | Allowed HTTP method | Path parameter | Generated method | Successful response |
| --- | --- | --- | --- | --- |
| `list` | `GET` | None | `list(query?, {signal}?)` | Array of model records |
| `get` | `GET` | Exactly one `{id}` | `get(id, {signal}?)` | One model record |
| `create` | `POST` | None | `create(record, {signal}?)` | One model record |
| `update` | `PUT` or `PATCH` | Exactly one `{id}` | `update(id, recordOrPatch, {signal}?)` | One model record |
| `delete` | `DELETE` | Exactly one `{id}` | `delete(id, {signal}?)` | Body ignored; returns `void` |

No other path parameters are supported. IDs are validated and URL-encoded. List query values may be strings, numbers, booleans, arrays of these, or `undefined`; undefined entries are omitted and arrays become repeated parameters. Query keys are serialized in sorted order.

`create` takes the complete model, including its ID. For `method: PUT`, `update` takes a complete replacement model; for `method: PATCH`, it takes a partial model. Both create and update reject unknown input fields. Choose operations matching the actual API; an API requiring a different creation payload or a command such as `approve` needs a handwritten adapter or wrapper. Successful create/update responses must contain a model; empty success responses are supported only for delete.

An optional `responsePath` selects nested response properties using dot-separated identifiers, such as `data.items`. It does not evaluate expressions, index arrays or inspect prototype properties. It is forbidden on delete operations. Without it, the entire JSON response is validated.

## JSON configuration

```yaml
kind: json
json:
  path: data/products.json
```

The path must be a contained relative POSIX path ending in `.json`. Its root is chosen by the application-supplied loader. The JSON file must contain an array of model records; duplicate IDs fail validation. JSON adapters expose only `list()` and `get(id)` and load the file anew for each call. They neither mutate the JSON file nor cache it.

Construction requires `loadJson(path): Promise<unknown>`, which reads and parses the file using the consuming runtime. An optional constructor `path` overrides the definition's default. Node applications can supply a filesystem loader; browser applications can supply a loader for a served JSON asset. There is no implicit browser fetch or filesystem access in the generated module.

## Fixtures and generated artifacts

Each generation writes exactly two files:

- `<adapter-directory>/<id>.ts`: TypeScript model, validators, error class and source adapter.
- `<fixture-directory>/<id>.fixtures.json`: a JSON array of deterministic synthetic records.

`testData` accepts either `count` or `records`. `count` is an integer from 1 to 100, defaulting to 3. Generated records include optional fields. Values use `example` when supplied, otherwise cycle through enum values, otherwise use indexed field names for strings, positive index values for numbers and alternating booleans. IDs are made unique; an ID enum must have at least as many values as the requested count. Explicit `records` supplies 1–100 complete, schema-validated records, permits omission of optional fields, rejects unknown fields and duplicate IDs, and is preserved as data. Do not combine `records` with `count`.

Fixtures are independent artifacts. They do not replace REST calls, intercept fetch, or automatically become the JSON source. To use a fixture as local JSON, point `json.path` or the constructor's `path` at that fixture and supply its loader. Generation never reads the runtime JSON source.

For `model.name: Product`, the adapter exports `Product`, `ProductId`, `ProductDataSourceError`, `ProductDataSourceOptions`, `createProductDataSource`, `validateProduct`, `validateProductId` and `validateProductList`; REST adapters also export `ProductQuery`. Exported model validators return the original data after checking declared fields; response records may retain extra API fields. Create/update inputs are validated strictly and reject unknown keys. List validation additionally rejects duplicate IDs.

Generated code has no runtime package dependencies. Compile it with TypeScript tooling that provides ES2022 and DOM/Fetch types, and run it in a runtime with the standard APIs it uses. Browser applications and Node 22+ satisfy the Fetch API requirement; inject `fetch` when adapting transport behavior. Framework-neutral adapters can be consumed by all UI targets after normal TypeScript compilation.

## Runtime failures and authentication

REST constructors accept `{baseUrl?, fetch?, headers?}`. Runtime headers can carry authentication. Inject a fetch implementation when token refresh, cookies, credentials options, retries or other transport policy is needed. Definitions contain no secret storage, login flow, authorization rules or generated server implementation. Server authorization remains authoritative.

Non-success HTTP responses throw `<Model>DataSourceError` with numeric `status`. Invalid JSON, missing response paths and invalid records also throw that class. JSON `get` throws it with status 404 when no record matches. Network/abort failures and errors thrown by the injected JSON loader propagate from that dependency. There is no implicit retry, timeout, pagination loop or offline cache.

## Planning, checks and revisions

`--plan` reports proposed output text and statuses `missing`, `unchanged` or `changed`; changed outputs include current text and current revisions. `--plan-out <new-file.json>` writes only a sorted revision map, leaving generated outputs untouched. `--check` exits 0 when every output matches, or exits 5 with `DATA_SOURCE_DRIFT` and path/status details. A drift check does not call the data source or compile generated code.

Generation is create-only unless `--revisions-from` supplies current SHA-256 revisions for every existing output. Map keys use workspace-relative output paths, including project directories; the map file is read relative to the active project/workspace. Missing/stale revisions cause `CONFLICT`; keys outside the generation plan or invalid hashes cause `INVALID_GENERATION_REVISIONS`. Plan/check modes reject `--revisions-from`. `--dry-run` previews an operation without writes or notifications.

Definition failures use `INVALID_DATA_SOURCE`; duplicate IDs use `DUPLICATE_DATA_SOURCE`; a missing selected ID uses `UNKNOWN_DATA_SOURCE`; generation/import from an empty library uses `EMPTY_DATA_SOURCE_LIBRARY`. All generated writes use the workspace's batch collision checks, revision guards and post-commit events.

Definition import/export source and destination directories must be disjoint: neither may equal or contain the other. This prevents transferred Markdown from being rediscovered as part of its own source library.
