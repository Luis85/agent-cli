# Code and UI generation

[Research index](README.md) · Researched 2026-10-10

## Summary

- The 2025–2026 consensus is hybrid: deterministic generators own structural code and LLMs handle business logic. The Forge's premise matches this, but its value depends on emitting formats that agents and other tools already understand.
- Agents increasingly *consume component metadata* (shadcn registry and MCP server, Storybook manifest and MCP addon, Custom Elements Manifest, Figma Code Connect, A2UI catalogs) rather than *invoke generators*. The Forge exports to none of these, so agents cannot discover its library outside the CLI.
- The Forge emits seven UI targets, which overlaps directly with Builder.io Mitosis (14.4k stars, more targets) and Stencil/Lit wrapper toolchains. A single-maintainer project cannot win on target breadth. The differentiators worth keeping are the safe declarative IR (no executable code, similar in spirit to A2UI), revision-guarded writes and drift exit codes.
- Interchange standards have stabilised and The Forge uses none of them:
  - DTCG design tokens 2025.10 is stable.
  - TypeSpec 1.0 went GA in 2025.
  - Zod 4 has native JSON Schema output.
  - Standard Schema and Standard JSON Schema provide a shared validator interface.
  - MCP Apps became an official MCP extension in January 2026.
- The data-source DSL (scalar fields, five CRUD operations) is a small subset of OpenAPI. Hey API, Orval and Kubb already generate typed clients, Zod schemas, Faker fixtures and MSW handlers from OpenAPI. Importing OpenAPI, or delegating to one of these tools, beats extending the DSL.
- The forms baseline (flat strings; `text`, `email` and `textarea` only) is far behind JSON Forms, RJSF, TanStack Form and Conform. Narrow it to "Standard Schema in, accessible HTML out, JSON Schema export", or drop it.
- Regeneration practice has moved past create-only overwrites, toward generation-gap splits, code regions and three-way merges (Speakeasy persistent edits, December 2025). The Forge already has drift checks (exit 5) and revision maps. It lacks an ownership model for handwritten edits, which is the main pain point of "generate, then let the agent edit".
- Accessibility is the clearest opening. AI site builders fail WCAG at high rates. Storybook's axe integration can fail CI on violations. Deterministic, accessibility-tested primitives with generated a11y stories would be a real differentiator. Today's catalog explicitly disclaims focus and keyboard behaviour.

## Method

I read the brief and The Forge's [UI component](../reference/ui-components.md), [interactions](../reference/interactions.md), [data sources](../reference/data-sources.md), [forms](../reference/forms.md) and [Storybook](../reference/storybook.md) references and the [deterministic UI explanation](../explanation/deterministic-ui.md). I then ran about 35 web searches and fetched primary pages (spec sites, official docs, repositories) where I could. Claims sourced only from search snippets or vendor blogs are marked *(unverified)*, *(seen in search)* or *(vendor)*. Nothing was installed or benchmarked; this is desk research as of 2026-10-10.

## Findings

### 1. Deterministic vs AI-driven generation

- **Hybrid is the recommended pattern.** One practitioner essay argues that deterministic generators win on reproducibility, cost and structural code but "can't handle anything not already defined in their templates". It recommends generating structure declaratively and narrowing the LLM to business logic ([DEV Community](https://dev.to/carracedo/probabilistic-vs-deterministic-choosing-the-right-code-generator-1nin)).
- **Research points the same way.** "Compiled AI" has an LLM generate code once and then run it deterministically. It reports 96% task completion with zero runtime tokens on BFCL and 57x fewer tokens at 1,000 transactions ([arXiv 2604.05150](https://arxiv.org/html/2604.05150)). This supports *generate once, run deterministically*. It does not show that template generators beat LLMs at writing UI.
- **Unaided AI UI output has accessibility problems.** A vendor-sponsored test had five AI tools (including Lovable) build 15 sites to WCAG AA. All 15 failed Level A, with about 55 issues per page ([VentureBeat, presented by AudioEye](https://venturebeat.com/ai/we-asked-five-ai-tools-to-build-accessible-websites-all-15-sites-failed), *vendor*). Academic work finds that novice developers rarely prompt for accessibility ([CodeA11y, arXiv 2502.10884](https://arxiv.org/html/2502.10884v1), *seen in search, not fully read*). A deterministic, accessibility-correct primitive layer is therefore valuable, but only if it actually encodes accessible behaviour.

### 2. Keeping regenerated code and hand edits apart

- **Generation gap.** Generated and handwritten code live in separate classes; generated code is never edited by hand ([Fowler](https://www.martinfowler.com/dslCatalog/generationGap.html)).
- **Ignore files plus a manifest.** OpenAPI Generator uses a `.openapi-generator-ignore` file and records what it generated in `.openapi-generator/FILES`. Its known cost is that ignored files stop receiving fixes (search snippets of [openapi-generator customization docs](https://github.com/antbell/openapi-generator/blob/master/docs/customization.md), *unverified*).
- **Code regions.** Speakeasy marks protected regions inside generated files. Its docs state plainly that editing generated files otherwise means "the next generation run [will] overwrite all edits" ([Speakeasy code regions](https://www.speakeasy.com/docs/sdks/customize/code/code-regions/overview.md)).
- **Persistent edits.** Speakeasy's December 2025 feature keeps arbitrary edits through regeneration. It merges "like git merge" and raises conflicts only when the same lines change ([Speakeasy blog](https://www.speakeasy.com/blog/release-arbitrary-custom-code)). Fern's comparison claims Fern, Stainless and APIMatic also use three-way merges ([Fern](https://buildwithfern.com/post/custom-code-preservation-tools-sdk-maintenance), *vendor; page not fully read*).
- **CI drift checks** usually regenerate and fail on `git diff --exit-code` ([templ CI guide](https://templ.guide/developer-tools/cicd), *seen in search*); The Forge's `--check` (exit 5) does this without git.
- **Generated output is moving into the source tree.** Prisma's new `prisma-client` generator requires an explicit `output` path and emits plain TypeScript ([Prisma 6.6.0](https://www.prisma.io/blog/prisma-orm-6-6-0-esm-support-d1-migrations-and-prisma-mcp-server), *seen in search*).

### 3. Cross-framework component IRs and agent-facing UI formats

- **Mitosis** compiles one component source to React, Vue, Angular, Svelte, Solid, Alpine, Qwik "and more". It has 14.4k stars, and Deutsche Bahn's DB UX design system uses it ([GitHub](https://github.com/BuilderIO/mitosis)).
- **Stencil** framework wrappers (`@stencil/react-output-target` and others) are reported to be maintained mainly for Ionic ([stencil-ds-output-targets mirror](https://fr.github.com/ionic-team/stencil-ds-output-targets), *unverified*).
- **Lit** moved to the OpenJS Foundation as an Impact Project on 2025-10-14, governed by a multi-vendor TSC ([Lit blog](https://lit.dev/blog/2025-10-14-openjs/)).
- **The Custom Elements Manifest** feeds docs, Storybook, language servers, linters, React/Vue/Svelte wrappers, Figma Code Connect and MCP servers ([Dave Rupert](https://daverupert.com/2025/10/custom-elements-manifest-killer-feature/)). Web Components plus a CEM may therefore be a cheaper route to multi-framework reach than seven native renderers.
- **Google A2UI** is a declarative JSON format for agent-generated UI: "a declarative data format, not executable code". Clients render it from their own catalog of pre-approved components ([Google Developers Blog](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/)).
  - v0.9 (April 2026) added custom catalogs, JSON Pointer bindings and named client-side `checks` for validation ([CopilotKit](https://copilotkit.ai/blog/a2ui-whats-new-in-google-generative-ui-spec)).
  - The repo marks v0.9.1 as current, v1.0 as a release candidate and the project as "early stage public preview" ([GitHub](https://github.com/google/A2UI)).
  - The Forge's IR (catalog-checked elements, typed bindings, no inline handlers) is conceptually close to this.
- **MCP Apps** standardises UI as `ui://` HTML resources rendered in sandboxed iframes over JSON-RPC/postMessage. It explicitly unifies the earlier MCP-UI and OpenAI Apps SDK approaches ([MCP Apps docs](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)).
  - ChatGPT reportedly adopted it in February 2026 ([AlternativeTo](https://alternativeto.net/news/2026/2/chatgpt-announces-full-support-for-mcp-apps-open-standard), *unverified*).
  - A Linux Foundation AAIF post lists Claude, VS Code, Cursor and others as hosts ([aaif.io](https://aaif.io/?p=909), *unverified*).
- **The shadcn registry** defines `registry.json` and `registry-item.json`. Item types include `registry:ui`, `registry:block`, `registry:page`, `registry:theme` and `registry:style`, and items carry `files`, `dependencies`, `registryDependencies` and `cssVars` ([registry-item docs](https://ui.shadcn.com/docs/registry/registry-item-json)).
  - The official shadcn MCP server lets Claude Code, Cursor, VS Code and Codex browse and install components from any spec-compliant or private namespaced registry ([shadcn MCP](https://ui.shadcn.com/docs/mcp)).
  - v0 consumes registries but "may struggle with any customizations" of shadcn primitives ([v0 docs](https://v0.app/docs/design-systems)).
- **Figma Code Connect** maps Figma components to code through CLI template files (`.figma.js`) and feeds Figma's MCP server ([Figma developer docs](https://developers.figma.com/docs/figma-mcp-server/skill-figma-code-connect), *seen in search*).

### 4. Design tokens

- **The DTCG format is now stable.** The Design Tokens Community Group published its first stable version, 2025.10, on 2025-10-28, with Format, Color and Resolver modules. It is a Final Community Group Report, not a W3C Standard ([W3C announcement](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/); [TR 2025.10](https://www.designtokens.org/tr/2025.10/)).
  - Files use `.tokens` or `.tokens.json` and the media type `application/design-tokens+json`.
  - Aliases are written `{group.token}`, and groups can inherit with `$extends` ([Format module](https://www.designtokens.org/tr/2025.10/format/)).
- **Style Dictionary** has had first-class DTCG support since v4. Full 2025.10 support is "a work in progress for v5" ([Style Dictionary DTCG](https://styledictionary.com/info/dtcg/)).

### 5. Storybook

- **Storybook 10 (October 2025)** is ESM-only. It needs Node 20.16+, 22.19+ or 24+, and adds module automocking (`sb.mock`) and Vitest 4 support ([Storybook 10 blog](https://storybook.js.org/blog/storybook-10/)).
  - Node 22.19 is above The Forge's 22.12 floor; this affects only consumers who run Storybook.
- **CSF Next (CSF Factories)** is in preview and documented for React, Vue, Angular and Web Components as of 10.6. An automigration (`csf-factories`) exists, and CSF3 remains supported ([CSF Next docs](https://storybook.js.org/docs/api/csf/csf-next)).
- **Accessibility testing.** The a11y addon uses axe-core, which catches "up to 57% of WCAG issues". `parameters.a11y.test: 'error'` fails tests in the UI and in CI through the Vitest addon ([Accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing)).
- **AI integration.** The Storybook MCP addon and components manifest let agents read component APIs and stories, write stories, and run interaction and accessibility tests. Both are in preview, with manifests generated for React, Angular-Vite and Vue3-Vite ([manifests](https://storybook.js.org/docs/ai/manifests); [AI overview](https://storybook.js.org/docs/ai)).

### 6. Forms and shared validation

- **Standard Schema** is a TypeScript interface (`~standard`, version 1) that validators implement and tools consume. Standard JSON Schema adds converters to `draft-2020-12`, `draft-07` and `openapi-3.0` ([standardschema.dev](https://standardschema.dev/); [repo spec](https://github.com/standard-schema/standard-schema)).
- **TanStack Form** ships official examples that use Zod, Valibot, ArkType and Effect schemas directly ([TanStack Form example](https://tanstack.com/form/v1/docs/framework/react/examples/standard-schema)).
- **Zod 4** has native `z.toJSONSchema()`, defaulting to draft 2020-12, with `openapi-3.0` as a target. Unrepresentable types throw unless configured, and `z.fromJSONSchema()` is experimental ([Zod JSON Schema](https://zod.dev/json-schema)).
- **JSON Forms** separates a JSON Schema (data) from a UI schema (layouts, controls and rules), with React, Angular and Vue bindings; 3.8.0 added Angular 22 ([jsonforms.io](https://jsonforms.io/)).
- **RJSF** is on an active 6.x line ([newreleases.io](https://newreleases.io/project/github/rjsf-team/react-jsonschema-form/release/v6.10.1), *seen in search*).
- **Conform** provides progressive enhancement over native HTML forms, with Zod and Valibot adapters and server actions, so the same schema validates on client and server ([Remix resources](https://remix.run/resources/conform), *seen in search*).

### 7. API and data adapters

- **Hey API openapi-ts** offers 20+ plugins, including Zod, Valibot and TanStack Query. It cites 5.1M weekly downloads and users including Vercel and PayPal ([heyapi.dev](https://heyapi.dev/)).
- **Kubb 5.x** has plugins for TypeScript, Zod, TanStack Query, MSW, Faker, Cypress and MCP, and supports OpenAPI 2.0, 3.0 and 3.1 ([kubb.dev](https://kubb.dev/)).
- **Orval** generates Faker factories and MSW handlers and can seed values from OpenAPI `example` fields. It has no seed option, so determinism requires `faker.seed()` in user code ([Orval Faker guide](https://orval.dev/docs/guides/faker)).
- **TypeSpec 1.0** went GA in 2025 with production-ready `@typespec/openapi3` and `@typespec/json-schema` emitters ([TypeSpec GA](https://typespec.io/blog/typespec-1-0-GA-release/), *seen in search*).

### 8. DDD and clean-architecture scaffolding

- **It helps in specific conditions.** Three Dots Labs lists them: complex domains, larger teams, testable domain logic, swappable adapters and parallel work, especially when a linter enforces dependency direction.
- **It becomes overengineering in others.** The same source flags simple domains, solo or small teams, single-implementation interfaces and mocking domain logic ([Three Dots Labs](https://threedots.tech/episode/is-clean-architecture-overengineering/)).
- I found no empirical evidence that file scaffolds alone improve outcomes; the cited benefit is the enforced boundary.

## Assessment of The Forge

### Strengths

- **The safe, declarative IR is well aligned with where agent UI is heading.** It uses strict schemas, rejects inline handlers, executable expressions and `v-*` directives, and validates references and binding types before planning writes. A2UI's "safe like data" catalog model validates the direction.
- **Regeneration discipline is better than most open-source generators offer by default.** Byte-stable output, `--plan`, `--check` exit 5, SHA-256 revision maps, `--dry-run` and post-commit events all come built in.
- **Story generation feeds existing infrastructure:** Storybook's Vitest and a11y addons and its MCP manifest all build on stories.
- **Generated data adapters are dependency-free,** strictly validated and take injected `fetch` and loaders.

### Gaps

- **No standard interchange formats.** There is no import or export for OpenAPI or TypeSpec, JSON Schema, DTCG tokens, CEM, the shadcn registry, A2UI catalogs or MCP Apps resources. Definitions only work inside The Forge.
- **No styling or design-system layer.** The docs state that output includes no stylesheet or design system. Tokens are the 2025–2026 standard for exactly this gap.
- **Accessibility is disclaimed rather than delivered.** `modal` and `accordion` provide markup only, and generated stories carry no a11y parameters.
- **No ownership model for edits.** Create-only plus revision maps prevents clobbering, but offers no generation-gap split, code regions or merge, so "the agent edits the output" has no supported path.
- **The data-source DSL is narrow.** It has scalar fields only, no nesting, arrays or dates, and five fixed operations. It will collide with real APIs immediately.
- **Forms are a separate, much weaker model.** They use flat strings and three field types, and are not connected to the UI component IR or to data-source models.
- **Seven targets is a large maintenance surface** for a single maintainer: Svelte relies on "legacy component/slot syntax" and Storybook is mid-migration to CSF Next.

### Candidates to narrow

- **UI targets.** Keep `html`/`vanilla`, consider Web Components plus a CEM, and keep React (largest agent ecosystem: shadcn, v0, the Storybook manifest). Freeze Vue, Svelte and Angular as experimental, or drop them.
- **Interaction actions.** `save-form`, `upload-form` and `download-form` are application concerns (persistence, transport) inside a presentation DSL. Narrow the DSL to state changes, `emit` and `navigate`.
- **Data sources.** Replace the bespoke DSL with OpenAPI import, or delegate to Hey API or Kubb.

## Recommendations

| ID | Recommendation | Priority | Effort | Rationale and evidence |
| --- | --- | --- | --- | --- |
| CG-1 | Reposition UI generation as an "agent-safe, deterministic, accessible primitives" layer and freeze target breadth. Keep html/vanilla and React as supported; mark Vue, Svelte and Angular experimental pending users. | P0 | S | Mitosis already covers more targets with community backing ([GitHub](https://github.com/BuilderIO/mitosis)). React dominates agent tooling ([shadcn MCP](https://ui.shadcn.com/docs/mcp), [Storybook manifests](https://storybook.js.org/docs/ai/manifests)). |
| CG-2 | Add an ownership model for regeneration: generate a protected base file plus a create-once handwritten wrapper (generation gap), and record generated files in a manifest. Document that agents edit only wrappers. | P0 | M | Fowler's [generation gap](https://www.martinfowler.com/dslCatalog/generationGap.html). The [Speakeasy](https://www.speakeasy.com/docs/sdks/customize/code/code-regions/overview.md) and OpenAPI Generator FILES approaches avoid lost edits. Without this, "generate then let the agent edit" ends in exit 5 or overwritten edits. |
| CG-3 | Generate a11y-tested stories: emit `parameters.a11y.test: 'error'` by default and ship keyboard/focus behaviour for catalog widgets that claim it (or remove `modal`/`accordion`). | P0 | M | axe-based checks fail CI ([Storybook a11y](https://storybook.js.org/docs/writing-tests/accessibility-testing)). AI builders fail WCAG widely ([VentureBeat](https://venturebeat.com/ai/we-asked-five-ai-tools-to-build-accessible-websites-all-15-sites-failed), vendor). This is a defensible differentiator. |
| CG-4 | Add `data-sources import --openapi <file>`, mapping supported schemas and operations to definitions and rejecting unsupported ones with exact JSON error details. Alternatively, document Hey API or Kubb as the recommended path for real APIs and keep the DSL for prototypes. | P1 | M | OpenAPI and TypeSpec are the standard sources ([TypeSpec GA](https://typespec.io/blog/typespec-1-0-GA-release/)). Mature generators exist ([Hey API](https://heyapi.dev/), [Kubb](https://kubb.dev/)). |
| CG-5 | Emit MSW 2 handlers (and optionally a Storybook loader snippet) from deterministic fixtures, alongside the existing `.fixtures.json`. | P1 | S | Fixtures do not currently intercept fetch. Orval and Kubb pair Faker with MSW ([Orval](https://orval.dev/docs/guides/faker)). Orval needs user-side `faker.seed()`, so The Forge's seedless determinism is a plus. |
| CG-6 | Accept DTCG 2025.10 token files (`.tokens.json`) and emit CSS custom properties consumed by generated components; reference tokens in definitions by alias (`{color.primary}`). Delegate complex transforms to Style Dictionary. | P1 | M | DTCG is stable ([W3C](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)). It closes the "no design system" gap without building a token engine ([Style Dictionary](https://styledictionary.com/info/dtcg/)). |
| CG-7 | Export the component library as metadata agents already read: a shadcn `registry.json` for the React target and a Custom Elements Manifest for a future Web Components target. | P1 | M | Registries reach Claude Code, Cursor, VS Code and Codex through the shadcn MCP server ([shadcn MCP](https://ui.shadcn.com/docs/mcp)). CEM feeds wrappers, Storybook, LSPs and MCP ([Rupert](https://daverupert.com/2025/10/custom-elements-manifest-killer-feature/)). |
| CG-8 | Rebase forms on Standard Schema plus Standard JSON Schema export. Make the HTML renderer accept any Standard Schema validator and emit JSON Schema for server reuse. Do not expand field types beyond native HTML inputs. | P1 | M | [Standard Schema](https://standardschema.dev/), [Zod `toJSONSchema`](https://zod.dev/json-schema) and [TanStack Form](https://tanstack.com/form/v1/docs/framework/react/examples/standard-schema) make the validator choice pluggable. JSON Forms and RJSF already own rich schema-driven UIs ([JSON Forms](https://jsonforms.io/)). |
| CG-9 | Prototype an A2UI catalog export, or an MCP Apps `ui://` HTML resource, from the html target, behind an experimental flag. | P2 | M | The IR maps closely to A2UI's catalog model ([Google](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/)), and MCP Apps is now an official extension ([MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)). Both specs still move (A2UI v1.0 is an RC), so wait for stability. |
| CG-10 | Track CSF Next: keep CSF3 output now and add a `--csf next` option once it leaves preview. | P2 | S | CSF Next is preview, and CSF3 stays supported ([CSF Next](https://storybook.js.org/docs/api/csf/csf-next)). |
| CG-11 | Remove `save-form`, `upload-form` and `download-form` from the interaction DSL, or move them to an opt-in plugin, and keep the core to state, `emit` and `navigate`. | P2 | S | These actions encode persistence and transport policy. Keeping the DSL bounded preserves the safety argument shared with A2UI. |
| CG-12 | Make DDD scaffolds earn their keep through enforced dependency direction (the existing structure checks), and keep `make entity/use-case` minimal and optional. | P2 | S | The benefit comes from enforced boundaries; layers are overkill for small domains ([Three Dots Labs](https://threedots.tech/episode/is-clean-architecture-overengineering/)). |

## What not to build

- **An LLM-driven UI generator, visual builder or "v0 clone".** v0, Lovable and Bolt compete there with model-tuned UX. The Forge's value is the deterministic counterpart.
- **More native framework renderers** (Solid, Qwik, Lit, SwiftUI). Mitosis, Stencil and CEM wrapper tools already do this.
- **A bespoke token transformer, validation library, OpenAPI client generator or mock server.** Use Style Dictionary or Terrazzo, Standard Schema validators, Hey API, Kubb or Orval, and MSW.
- **An A2UI or MCP Apps renderer or host.** At most, emit their formats.
- **Three-way merge of arbitrary generated files.** A generation-gap split is simpler and fits revision guards.
- **Richer JSON Forms-style layouts and rules in the form model.** Integrate rather than compete.

## Open questions

- Does anyone need Vue, Svelte or Angular output? There are no users yet, so target choice is untested. A usage probe, or a single external adopter, should decide CG-1.
- Should the UI IR converge on an existing schema (A2UI catalog JSON, or Mitosis JSON) rather than keep a custom Markdown frontmatter schema? This depends on how stable A2UI v1.0 is.
- Can generated React output be made registry-compatible without adopting Tailwind and shadcn conventions (`cssVars`, `registry:ui`)? Is that convention coupling acceptable?
- How should token references interact with the strict attribute model, given that `class` and `style` are free strings today?
- Is the forms module worth keeping at all if components plus interactions plus Standard Schema can express the same form?

## Sources

- https://dev.to/carracedo/probabilistic-vs-deterministic-choosing-the-right-code-generator-1nin
- https://arxiv.org/html/2604.05150
- https://venturebeat.com/ai/we-asked-five-ai-tools-to-build-accessible-websites-all-15-sites-failed (vendor-sponsored)
- https://arxiv.org/html/2502.10884v1 (seen in search)
- https://www.martinfowler.com/dslCatalog/generationGap.html
- https://github.com/antbell/openapi-generator/blob/master/docs/customization.md (seen in search, unverified)
- https://www.speakeasy.com/docs/sdks/customize/code/code-regions/overview.md
- https://www.speakeasy.com/blog/release-arbitrary-custom-code
- https://buildwithfern.com/post/custom-code-preservation-tools-sdk-maintenance (vendor; not fully read)
- https://templ.guide/developer-tools/cicd (seen in search)
- https://www.prisma.io/blog/prisma-orm-6-6-0-esm-support-d1-migrations-and-prisma-mcp-server (seen in search)
- https://github.com/BuilderIO/mitosis
- https://fr.github.com/ionic-team/stencil-ds-output-targets (mirror, unverified)
- https://lit.dev/blog/2025-10-14-openjs/
- https://daverupert.com/2025/10/custom-elements-manifest-killer-feature/
- https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/
- https://copilotkit.ai/blog/a2ui-whats-new-in-google-generative-ui-spec
- https://github.com/google/A2UI
- https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html
- https://alternativeto.net/news/2026/2/chatgpt-announces-full-support-for-mcp-apps-open-standard (unverified)
- https://aaif.io/?p=909 (unverified)
- https://ui.shadcn.com/docs/registry/registry-item-json
- https://ui.shadcn.com/docs/mcp
- https://v0.app/docs/design-systems
- https://developers.figma.com/docs/figma-mcp-server/skill-figma-code-connect (seen in search)
- https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
- https://www.designtokens.org/tr/2025.10/
- https://www.designtokens.org/tr/2025.10/format/
- https://styledictionary.com/info/dtcg/
- https://storybook.js.org/blog/storybook-10/
- https://storybook.js.org/docs/api/csf/csf-next
- https://storybook.js.org/docs/writing-tests/accessibility-testing
- https://storybook.js.org/docs/ai/manifests
- https://storybook.js.org/docs/ai
- https://standardschema.dev/
- https://github.com/standard-schema/standard-schema
- https://tanstack.com/form/v1/docs/framework/react/examples/standard-schema
- https://zod.dev/json-schema
- https://jsonforms.io/
- https://newreleases.io/project/github/rjsf-team/react-jsonschema-form/release/v6.10.1 (seen in search)
- https://remix.run/resources/conform (seen in search)
- https://heyapi.dev/
- https://kubb.dev/
- https://orval.dev/docs/guides/faker
- https://typespec.io/blog/typespec-1-0-GA-release/ (seen in search)
- https://threedots.tech/episode/is-clean-architecture-overengineering/
