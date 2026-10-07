# Maintain shared interaction definitions

[Documentation](../index.md) · How-to

Use this guide when you have a component library and want to maintain reusable
browser behavior. Definitions live at workspace scope even when a project is
open. See [the schema reference](../reference/interactions.md) for supported
states, events and actions.

## Initialize and inspect

```sh
node bin/app.js interactions init --dry-run
node bin/app.js interactions init
node bin/app.js interactions list
node bin/app.js interactions create toggle-details --event click --dry-run
node bin/app.js interactions create toggle-details --event click
node bin/app.js interactions inspect toggle-details
node bin/app.js interactions validate
```

Edit the created Markdown file to express the intended actions. Declare every
referenced state field in each component that attaches the interaction. Validate
the complete graph with `components validate`; validating the interaction
library alone cannot know the component's state or attached element type.

To edit a shared definition with guarded generic file commands, close an active
project first. Use `read` to obtain its revision, then `write`, `edit` or
`properties` with `--if-match`. Opening a project does not move shared libraries.

## Transfer and select libraries

```sh
node bin/app.js interactions export --out exchange/interactions
node bin/app.js interactions import --from exchange/interactions --library reviewed-interactions
node bin/app.js components validate --interactions-library reviewed-interactions
node bin/app.js make ui contact-request --framework react --interactions-library reviewed-interactions --dry-run
```

The last command assumes your component library already contains the
[contact-request example](../../examples/interactions/components/contact-request.md)
and the selected interaction library contains its referenced definitions. Imports
and exports refuse existing destination files. Adjust the three interaction
paths in `bin/config.json` to make custom locations the defaults.

## Regenerate after behavior changes

Run the same generation command and target you used originally, selecting the
same project and libraries. Review the proposed changes before authorizing an
overwrite:

```sh
node bin/app.js make ui contact-request --framework react --plan-out interaction-review.json
node bin/app.js make ui contact-request --framework react --revisions-from interaction-review.json
node bin/app.js make ui contact-request --framework react --check
```

The review file is create-only; choose a new name for a later review. Inspect its
associated `outputs` in the planning response, including `currentContent` for
changed files. Revision-map keys remain workspace-relative; the map file itself
is read from the selected output scope. Add `--stories` consistently if stories
are part of the output set. A missing or changed generated output makes
`--check` exit with code 5.

Finally run the consuming project's framework compiler and behavior tests.
Exercise the actual browser events and emitted custom events, including keyboard
and invalid form input. Deterministic generation and drift checks do not replace
runtime validation.
