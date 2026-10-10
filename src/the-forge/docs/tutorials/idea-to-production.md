# Take an idea toward production with The Forge

Work through a concrete purchase-approval example: refine the problem, describe behavior, generate a presentational UI, then plan the application work and release evidence. You will produce deterministic components and Storybook files in a managed project. The example does not deploy or implement a purchase service.

## Prepare a workspace

Use Node 22.12 or newer. In a new workspace, copy the complete repository `bin` directory and `docs/examples/idea-to-production` directory, preserving those relative paths. Reset the copied checkout configuration and selection only in that new destination:

```sh
cp bin/config/default.json bin/config.json
rm -f bin/data/context.json
```

An extracted release already has generic settings and no selection. Run all CLI commands below from that workspace root. This keeps tutorial projects outside your Forge source checkout. The executable resolves its workspace from its `bin` location, not the current shell directory.

```sh
node bin/forge.js --version
node bin/forge.js setup --dry-run
node bin/forge.js setup
node bin/forge.js config --json
node bin/forge.js project close
node bin/forge.js project current --json
```

Inspect `data.config.paths` and returned `context`; stop if they point at an unintended workspace. Closing selection in this new workspace ensures copied local context cannot route the planning document into another project. The example commands use explicit project and generation paths. Project creation follows configured `paths.projects` (default `projects`). Other relative paths in this tutorial are deliberately explicit.

## 1. Turn a hypothesis into an acceptance contract

Read the [opportunity](../examples/idea-to-production/01-opportunity.md), [PRD](../examples/idea-to-production/02-prd.md) and [use case](../examples/idea-to-production/03-use-case.md). The product is small enough to reason about: an employee requests a purchase and an assigned manager records exactly one decision. Note what happens when the response is lost or another session has already decided.

Use the first [stage prompt](../examples/idea-to-production/prompts.md) to refine the artifacts against your own evidence. The sample's targets are hypothetical and its research register is empty. Before committing to a real product, record scope, outcome and ownership decisions. Keep `REQ-*`, `UC-*` and `T-*` identifiers stable so changes remain traceable.

For your own product, `setup` installs reusable workflow templates under `bin/templates/workflow`. Inspect inputs before generating a new document. In this fresh workspace, no project is selected, so these commands create a workspace document under `planning`:

```sh
node bin/forge.js templates inspect workflow/prd.md
node bin/forge.js make document 'Purchase Approvals PRD' --template workflow/prd.md --values '{"owner":"Product owner"}' --date 2026-10-07 --out planning --dry-run
node bin/forge.js make document 'Purchase Approvals PRD' --template workflow/prd.md --values '{"owner":"Product owner"}' --date 2026-10-07 --out planning
```

The fixed example date makes this exercise reproducible; supply the actual planning date for your own work. The generated document is a starting structure to fill, while this example's PRD shows the expected specificity. Other templates cover use case, build specification, design, implementation plan, test plan and release plan.

## 2. Inspect the design and component library

Read the [build specification](../examples/idea-to-production/04-build-specification.md). Its state table includes behavior beyond a static component, such as saving, stale revisions and keyboard error recovery. Inspect the two schema-valid definition files:

```sh
node bin/forge.js components list --library docs/examples/idea-to-production/components
node bin/forge.js components inspect approval-page --library docs/examples/idea-to-production/components
node bin/forge.js components validate --library docs/examples/idea-to-production/components
```

`approval-page` references `request-summary`, passes scalar props and supplies a child link to its slot. The generator traverses this dependency automatically. Product documents live outside the library directory because component discovery validates every Markdown file under the selected library. The schema excludes arbitrary framework expressions and event code; use native application code for those behaviors.

## 3. Generate a project, UI and stories

```sh
node bin/forge.js project create purchase-approvals --dry-run
node bin/forge.js project create purchase-approvals
node bin/forge.js make ui approval-page --library docs/examples/idea-to-production/components --project purchase-approvals --framework react --out src/ui/generated --stories --stories-out stories/generated --dry-run
node bin/forge.js make ui approval-page --library docs/examples/idea-to-production/components --project purchase-approvals --framework react --out src/ui/generated --stories --stories-out stories/generated
```

Inspect the preview before the final invocation. In a default workspace, output includes two `.tsx` components under `projects/purchase-approvals/src/ui/generated` and two CSF story files under `projects/purchase-approvals/stories/generated`. Check the actual response for paths and verify its `context.root`. `--project` targets this project for the invocation without changing another saved selection.

The Forge project begins as a TypeScript library with a Vite form showcase. Add and lock React/React types, JSX-aware build configuration and the matching Storybook framework/builder in the target project before compiling this React output. See [Storybook setup and extensions](../reference/storybook.md). Include `stories/generated` in the actual Storybook glob. The CLI does not install these dependencies or start Storybook. To experiment without a framework runtime, generate `--framework html` into a separate UI and story directory instead.

The sample's stories vary status and long text. They do not implement decisions or simulate authorization. Declare additional story names in Markdown, then use native extension modules for real interaction tests, decorators and API mocks. Confirm them in your installed Storybook version.

### Generate data adapters and synthetic records

Keep data definitions in their own library and output outside domain code:

```sh
node bin/forge.js data-sources validate --library docs/examples/idea-to-production/sources
node bin/forge.js make data-source purchase-requests --library docs/examples/idea-to-production/sources --project purchase-approvals --out src/infrastructure/generated --test-data-out testdata/generated --dry-run
node bin/forge.js make data-source purchase-requests --library docs/examples/idea-to-production/sources --project purchase-approvals --out src/infrastructure/generated --test-data-out testdata/generated
node bin/forge.js make data-source approvers --library docs/examples/idea-to-production/sources --project purchase-approvals --out src/infrastructure/generated --test-data-out testdata/generated --dry-run
node bin/forge.js make data-source approvers --library docs/examples/idea-to-production/sources --project purchase-approvals --out src/infrastructure/generated --test-data-out testdata/generated
```

Each definition produces `<id>.ts` and `<id>.fixtures.json` in the selected directories. The REST adapter's `createPurchaseRequestViewDataSource({ baseUrl, fetch })` factory exposes `get(id)` for this definition; inject your application's authenticated fetch and actual URL. Generation does not contact the placeholder endpoint. The local factory `createDemoApproverDataSource({ loadJson })` uses an injected loader for the configured relative JSON path. Here that path matches the generated approver fixture; root a filesystem loader at the consuming project, or configure deliberate browser fixture serving.

Adapt the read model into UI props in native feature code: format `amountMinor / 100` as EUR, resolve the requester display name through an authorized source, and map status to display text. Add loading/error state around the adapter call. Server authorization, submission/decision contracts, domain rules, retries and idempotency are still implementation work; neither generated transport validation nor local demo membership can supply them. See [data-source contracts](../reference/data-sources.md).

## 4. Refine and regenerate safely

Edit one definition, validate it, and generate a separate comparison:

```sh
node bin/forge.js components validate --library docs/examples/idea-to-production/components
node bin/forge.js make ui approval-page --library docs/examples/idea-to-production/components --project purchase-approvals --framework react --out review/ui --stories --stories-out review/stories --dry-run
node bin/forge.js make ui approval-page --library docs/examples/idea-to-production/components --project purchase-approvals --framework react --out review/ui --stories --stories-out review/stories
```

Inspect the changed text and expected import-path differences. Once these directories exist, repeating a create-only generation conflicts; choose a fresh directory or use [reviewed revision-map regeneration](../how-to/manage-components.md). Determinism means identical inputs/framework/paths yield identical bytes; it does not mean existing files are automatically overwritten. Keep authored behavior outside generated files.

Library, UI, story, import and export paths have configuration settings as well as overrides; see [configuration](../reference/configuration.md). Library/transfer paths are workspace-relative, while UI/story output is relative to the explicitly selected project. You can export this exact fixture library without changing it:

```sh
node bin/forge.js components export --library docs/examples/idea-to-production/components --out exchange/purchase-ui --dry-run
node bin/forge.js components export --library docs/examples/idea-to-production/components --out exchange/purchase-ui
```

## 5. Implement and verify a vertical slice

Use the [delivery plan](../examples/idea-to-production/05-delivery-plan.md) and implement/test prompts. Scaffold only useful starting points after inspecting the project:

```sh
node bin/forge.js project inspect purchase-approvals --json
node bin/forge.js project component purchase-approvals PurchaseRequest --kind domain --dry-run
node bin/forge.js project component purchase-approvals PurchaseRequest --kind domain
```

Replace generic scaffold behavior with the specified domain invariants. Implement identity, server authorization, transactional persistence, idempotency, feature orchestration and accessible interaction in the target application. Review missing loading/error states as carefully as the happy path. Generation has not supplied these behaviors.

From the target project directory, run `npm install` for the first dependency resolution, inspect and commit the lockfile, then use `npm ci` for reproducible subsequent installs. Run `npm run check:fast` during implementation and `npm run check` before delivery. Add the chosen framework, browser and Storybook checks to the application's real scripts. Record executed results against T-01–08; a green CLI check is not application evidence.

## 6. Make a release decision from evidence

Complete the [validation/release ledger](../examples/idea-to-production/06-validation-and-release.md), including manual accessibility results, tenant-isolation/concurrency tests, staging rehearsal and named operational ownership. Use the deploy prompt only after choosing the actual provider, commands and target environment. The Forge has no deployment command.

Prepare a reviewed release artifact and provider-specific runbook, carry out authorized deployment, and verify the acceptance smoke tests. If release authorization or required evidence is missing, finish the concrete preparation and record the blocker. After a pilot, compare observed outcomes with the baseline and use the retrospective prompt to update requirements and the next implementation slices.
