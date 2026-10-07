# Storybook generation and extension reference

[Documentation](../index.md) · Reference

This reference describes generated CSF modules and their native extension API. It assumes an existing component library and a consuming project configured for its chosen Storybook renderer. See [your first UI](../tutorials/first-ui.md) for the sample dashboard used below.


`make ui <id> --stories` writes UI and stories in the same planned batch. `make stories <id>` writes only stories, using `--out` as the location of previously generated UI and `--stories-out` as the story destination:

```sh
node bin/app.js make ui dashboard --framework react --out src/dashboard
node bin/app.js make stories dashboard --framework react --out src/dashboard --stories-out stories/dashboard --dry-run
```

Each component gets `<id>.stories.ts` using standard CSF3 default metadata and named story object exports. Props provide default args and controls; the Markdown body provides docs text. Configure your Storybook story glob to include the selected folder. The import uses `@storybook/html` for HTML/HTMX/vanilla, `@storybook/react`, `@storybook/vue3`, `@storybook/svelte` or `@storybook/angular` for the corresponding target. Install and configure the matching Storybook framework, builder and desired addons in the consuming project. The CLI does not run Storybook, install packages or alter its configuration.

Declarative `storybook` fields are `title`, `tags`, `args`, `argTypes`, `parameters`, `stories` and `extension`. A story has `name` and optional `args`, `tags`, `parameters`; omitted stories produce `Default`. Args must match declared scalar props. Parameters and argTypes accept JSON-compatible data. Use native extension modules for functions and framework-specific features: decorators, loaders, play interactions, hooks, custom renderers, providers, Angular module/application metadata, and addon APIs.

For example, add `extension: storybook/dashboard.extensions.ts` to the dashboard's `storybook` frontmatter. Create that workspace-relative file:

```ts
import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';

export const meta = {
  parameters: { layout: 'fullscreen' },
} satisfies Partial<Meta>;

export const stories = {
  Default: {
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Project overview');
    },
  },
} satisfies Record<string, StoryObj>;
```

Use the testing entry point provided by your installed Storybook version; the example uses `storybook/test`. Export optional `meta` and `stories` objects. Keys in `stories` must match declared story names. Extensions merge last at the metadata/story top level, so an extension's `parameters`, `args` or other object replaces that generated property rather than deep-merging it. Storybook statically indexes titles, tags and named story exports, so declare them in Markdown rather than overriding them dynamically in extensions. Additional named story exports require names in the Markdown `stories` list. Extensions can supply any native API supported by the installed renderer and addons; generated CSF does not guarantee every addon or Storybook version works without configuration.

The CLI checks that extension files exist and emits relative imports; it never executes them. Extension paths are workspace-relative even when output targets a project. Place extensions where the target toolchain can resolve their dependencies, and configure that toolchain if it imports shared files outside its project root. Treat extensions as ordinary executable project code.
