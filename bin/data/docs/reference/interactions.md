# Interaction definitions and generated behavior

[Documentation](../index.md) · Reference

Interactions are reusable Markdown files with strict YAML frontmatter. Components
attach their IDs to elements; UI generation resolves those references and emits
executable handlers for HTML, HTMX, vanilla JavaScript, React, Vue, Svelte and
Angular. Follow [the interactive-form tutorial](../tutorials/interactive-form.md)
for a complete example, or [manage interactions](../how-to/manage-interactions.md)
for maintenance commands.

## Definition schema

```markdown
---
schemaVersion: 1
id: toggle-expanded
event: click
actions:
  - type: toggle-state
    state: expanded
  - type: emit
    event: panel:changed
    detail:
      expanded: "{{state.expanded}}"
---
Toggle the owning component's expanded state, then notify the application.
```

| Field | Contract |
| --- | --- |
| `schemaVersion` | Required literal `1` |
| `id` | Required unique lowercase kebab-case interaction ID |
| `event` | `click`, `dblclick`, `input`, `change`, `submit`, `keydown`, `keyup`, `focus`, or `blur` |
| `keys` | Optional keyboard-key filter for `keydown`/`keyup`; names match `KeyboardEvent.key`, for example `[Enter, Escape]` |
| `preventDefault` | Optional boolean; cancel the event's default browser behavior when the handler matches |
| `stopPropagation` | Optional boolean; stop the original event's propagation when the handler matches |
| `actions` | Required nonempty ordered list of declarative actions |
| Markdown body | Human documentation; never executed as code |

Unknown fields and unsupported event/action kinds are rejected. Keyboard filters
apply before the handler's actions and event cancellation. Multiple interactions
attached to an element handle their declared events in definition-list order.

## Actions

| Action | Fields | Behavior |
| --- | --- | --- |
| `set-state` | `state`, and exactly one of `value` or `fromEvent` | Assign a literal/binding value or a supported event value to component-local state |
| `toggle-state` | `state` | Invert a declared boolean state field |
| `navigate` | `url` | Navigate to a relative destination or an HTTP(S) URL |
| `emit` | `event`, optional scalar-valued `detail` map | Dispatch a bubbling, composed native `CustomEvent` from the attached element |

`set-state.value` accepts the same scalar values and bindings as component values.
`fromEvent: value` reads a string from an input/select/textarea on `input` or
`change`; it does not convert numbers. `fromEvent: checked` reads a boolean from
an input on those events. Graph validation checks the attached element and the
declared state's type. Numeric state can be assigned a numeric literal or a
compatible whole binding. Use `input` to commit each text edit; `change` commits
only when that browser event occurs. A state-bound control remains governed by
component state during framework rerenders, so an uncommitted DOM draft is not
guaranteed to survive an unrelated update.

Actions run in order. Later actions read state updates made by earlier actions
in the same handler, including values used in emitted `detail`. An emitted event
cannot reuse native trigger names such as `click` or `submit`, preventing direct
self-dispatch recursion. It has no additional envelope: listeners receive the declared object as
`event.detail`. Native custom events provide the same application boundary in
all seven generated targets; they are not framework-specific callback props or
Angular output declarations.

Navigation rejects executable schemes, protocol-relative URLs, credentials and
unsafe URL syntax. The definition does not permit arbitrary JavaScript, dynamic
code evaluation, API calls, persistence, timers or conditional expressions.
Implement application-specific side effects in ordinary consuming code.

## Component state and attachment

Add component-local state with explicit scalar types and defaults:

```yaml
state:
  expanded:
    type: boolean
    default: false
root:
  tag: button
  attrs:
    type: button
    aria-expanded: "{{state.expanded}}"
  text: "Expanded: {{state.expanded}}"
  interactions: [toggle-expanded]
```

State types are `string`, `number` and `boolean`; defaults are required and must
match the type. `{{propName}}` reads a prop; `{{state.name}}` reads state. Whole
bindings preserve scalar types; interpolation produces text. State belongs to
each component instance and is not shared between instances or persisted.

Attach `interactions` to element nodes, not component references or child slots.
Each reference resolves against the selected shared interaction library. The
component must declare the state fields used by the interaction. Validation
rejects missing IDs, unknown state/prop bindings, incompatible assignments and
invalid event-value sources before generating files. References can be reused
by components with compatible state contracts.

## Libraries, paths and generation

| Configuration key | Default | Scope |
| --- | --- | --- |
| `paths.interactions` | `interactions` | Workspace definition library |
| `paths.interactionImports` | `imports/interactions` | Workspace import source |
| `paths.interactionExports` | `exports/interactions` | Workspace export destination |

`interactions list/init/inspect/validate/create/import/export` manage the library;
`--library` overrides its location. `create <id> --event <event>` creates an
editable starter. `import --from` and `export --out` override transfer paths.
Definitions are discovered recursively and IDs must be unique. Transfer source/destination directories must be disjoint: neither may equal or
contain the other. Transfers use the ordinary create-only, dry-run and revision/event write contract.

`components --interactions-library <directory>` selects the interaction library
used for component graph validation. `make ui` and `make stories` accept the
same override. Interaction sources stay workspace-scoped while generated UI,
stories and revision-manifest files follow the selected project/workspace scope.

There is no standalone interaction-code generator: handlers are emitted with
the components that use them. UI `--plan`, `--plan-out`, `--revisions-from`,
`--check`, `--dry-run` and output-path options retain their existing meanings.
Changing an interaction can change generated components; run the same UI drift
check and reviewed regeneration workflow after editing it.

## Runtime boundaries

Framework targets update state through their native component lifecycle. For
HTML, HTMX and vanilla JavaScript, mount the generated ES-module factory to
activate handlers. A standalone `.html` fragment is the initial static snapshot;
opening or inserting it alone does not attach the generated JavaScript behavior.
HTMX server endpoints and HTMX initialization remain application concerns.

Generated state/actions do not supply a complete widget accessibility contract.
Choose semantic elements, label controls, preserve keyboard access, and test
focus and assistive-technology behavior in the consuming application. Native
form constraints guide users; authorization and server validation remain
application responsibilities. Storybook renders the same executable component;
use native story extensions for interaction tests and application-specific mocks.
