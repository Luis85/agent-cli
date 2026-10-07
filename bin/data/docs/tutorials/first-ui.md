# Build your first Markdown-defined UI

[Documentation](../index.md) · Tutorial

This tutorial creates two reusable components, composes a dashboard and previews deterministic generated code. Start with a workspace containing the complete `bin` distribution and Node >=22.12. Complete [getting started](getting-started.md) first if needed.

## Initialize a shared library

From a workspace containing the portable distribution:

```sh
node bin/app.js components init --dry-run
node bin/app.js components init
node bin/app.js components list
node bin/app.js components inspect page
node bin/app.js components validate
node bin/app.js make ui page --framework react --stories --dry-run
node bin/app.js make ui page --framework react --stories
```

`components init` creates starter definitions in `paths.components` (default `components`). It preserves IDs already in the library and adds missing starters. Starter components are semantic HTML building blocks; adding a component file extends the library without a CLI rebuild. `components create notice --tag aside` creates a minimal definition to customize. The library is discovered recursively from `.md` files, so organize it into subdirectories if useful. Each ID must be unique across the entire library. The starters cover page/layout/header/footer/navigation, text and links, form controls, tables/lists, disclosure/dialog and media elements, plus card, container, stack, grid, breadcrumbs, alert, status, badge, avatar, modal, accordion, toolbar, pagination and search. Layout primitives supply class names; the application supplies their CSS. They provide semantic structure. Attach [declarative interactions](../reference/interactions.md) to generate local behavior; styling and complete widget accessibility remain application work.

The generated UI defaults to `src/ui` and stories to `stories` in the open project, or the workspace when no project is open. To target a managed project for one invocation:

```sh
node bin/app.js project create portal
node bin/app.js make ui page --framework vue --project portal --stories --dry-run
node bin/app.js make ui page --framework vue --project portal --stories
```

This does not open or persist the project. `project open portal` selects it for later invocations. The generated project needs the chosen framework's build dependencies and application integration; creating a Forge project does not install Vue, React or Storybook.

## Define components

Save this as `components/surface.md` in the workspace:

```markdown
---
schemaVersion: 1
id: surface
name: Surface
props:
  heading:
    type: string
    required: true
    default: Overview
    description: Visible section heading
root:
  tag: section
  attrs:
    class: surface
  children:
    - tag: h2
      text: "{{heading}}"
    - slot: children
storybook:
  title: Layout/Surface
  tags: [autodocs]
  args:
    heading: Project activity
  argTypes:
    heading:
      control: text
  parameters:
    layout: padded
  stories:
    - name: Default
    - name: LongHeading
      args:
        heading: Recent activity across all projects
---
A titled section that groups related content. Supply child elements after the heading.
```

Save this as `components/dashboard.md`:

```markdown
---
schemaVersion: 1
id: dashboard
name: Dashboard
props:
  title:
    type: string
    default: Project overview
  count:
    type: number
    default: 3
root:
  tag: main
  attrs:
    class: dashboard
  children:
    - tag: h1
      text: "{{title}}"
    - component: surface
      props:
        heading: Active projects
      children:
        - tag: p
          text: "You have {{count}} active projects."
        - tag: a
          attrs:
            href: /projects
          text: View projects
storybook:
  title: Pages/Dashboard
  parameters:
    layout: fullscreen
  stories:
    - name: Default
    - name: Empty
      args:
        count: 0
---
An overview page composed from the reusable surface component.
```

Then validate and preview:

```sh
node bin/app.js components validate
node bin/app.js make ui dashboard --framework react --out src/dashboard --stories --stories-out stories/dashboard --dry-run
```

Generation includes the selected component and its transitive component references. A component with `slot: children` renders content supplied by its caller. The first iteration has one default child slot; it does not define named slots or arbitrary template code.


Next, [build an interactive form](interactive-form.md), read the [definition and target reference](../reference/ui-components.md), [add Storybook stories](../reference/storybook.md), or [maintain and regenerate components](../how-to/manage-components.md).
