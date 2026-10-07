# UI component definition and target reference

[Documentation](../index.md) · Reference

Markdown files describe a framework-neutral component tree; YAML frontmatter is the strict schema and the body is documentation. For a worked example, follow [your first UI](../tutorials/first-ui.md). For path configuration, transfer and guarded regeneration, use [manage components](../how-to/manage-components.md).

## Definition contract

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Required literal `1` |
| `id` | Required unique lowercase kebab-case ID used for references and output filenames |
| `name` | Optional generated component/export name; PascalCase letters/digits starting with an uppercase letter |
| `props` | Optional map of prop declarations with `type: string`, `number` or `boolean`, plus optional `default`, `required`, `description` |
| `root` | One element, component reference or child slot |
| `storybook` | Optional metadata and native extension path |
| Markdown body | Documentation text, also used as Storybook's component description |

An element has `tag` and optional `attrs`, `text`, `children`. A reference has `component` and optional `props`, `children`. A slot is exactly `{slot: children}` and may occur at most once per definition, including inside reference children; this preserves child identity across all targets. Attributes and prop values are scalar values; bindings use `{{propName}}` and may appear in text, attributes and reference props. A whole binding retains its scalar type, while surrounding text produces a string. Required reference props without defaults must be supplied. Unknown props, type mismatches, missing references, duplicate IDs, repeated child slots, malformed bindings and cyclic references fail validation.

Frontmatter is a strict schema: unrelated keys are rejected. Use normal HTML attribute names, such as `class`, `for`, `aria-label` and `data-state`; renderers translate supported framework differences. Portable names start with a letter and contain letters, digits, underscores or hyphens. Namespaced attributes containing colons or dots and `v-*` directives are excluded; implement framework-specific directives in native project code. This version also rejects `svg` and `math` namespace roots. Use image assets or native framework code for SVG/MathML until the declarative tree supports namespaces. Props use safe JavaScript identifiers; `children` is reserved for projection. Inline event-handler attributes and executable template expressions are not part of the declarative contract. Text is escaped or rendered through text nodes rather than interpreted as markup. Add event listeners, state and application behavior in the consuming framework.

## Target artifacts and dependencies

| `--framework` | Generated artifacts per component | Consuming environment |
| --- | --- | --- |
| `html` | `.html` fragment, `.js` DOM factory and `.d.ts` types | Static HTML or browser ES modules; no UI runtime dependency |
| `htmx` | `.html` fragment, `.js` DOM factory and `.d.ts` types | Browser plus HTMX when using `hx-*` attributes |
| `vanilla` | `.html` fragment, `.js` DOM factory and `.d.ts` types | Browser ES modules; caller mounts DOM and attaches listeners |
| `react` | `.tsx` component with typed props | React, React types and TypeScript tooling |
| `vue` | `.vue` single-file component | Vue 3 with TypeScript/SFC tooling |
| `svelte` | `.svelte` component | Svelte with TypeScript support and legacy component/slot syntax support |
| `angular` | `.ts` standalone component | Angular with standalone components, required inputs and TypeScript/decorator tooling |

HTML fragments use defaults at generation time; their JS factories accept runtime props and child DOM nodes. Companion declaration files let TypeScript consumers typecheck those factories without enabling unchecked JavaScript imports. For example, after generating the sample dashboard as `html` into `src/ui`, mount it from a browser module:

```js
import createDashboard from './src/ui/dashboard.js';
document.querySelector('#app').append(createDashboard({ title: 'Workspace', count: 5 }));
```

Serve modules through your application's HTTP server. HTMX attributes are preserved, but the CLI does not install HTMX or define server endpoints. Dynamic nodes may require the consuming application's normal HTMX initialization. Generated output does not include a router, state manager, stylesheet, design system, API implementation or framework build configuration.


Story metadata and native extension hooks are documented in the [Storybook reference](storybook.md). The [determinism explanation](../explanation/deterministic-ui.md) describes the generation boundary.
