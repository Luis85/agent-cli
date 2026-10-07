# Markdown templates

Templates are Markdown files with optional YAML frontmatter in the workspace's shared `bin/templates` directory. They produce ordinary Obsidian-compatible `.md` files without requiring Obsidian. Inspect the configuration and available inputs before generating:

```sh
node bin/app.js config --json
node bin/app.js templates list --json
node bin/app.js templates inspect feature.md --json
node bin/app.js make document 'Feature proposal' --template feature.md --values '{"owner":"Engineering"}' --dry-run
node bin/app.js make document 'Feature proposal' --template feature.md --values '{"owner":"Engineering"}'
```

`templates inspect` and `make document` both require a `.md` template (case insensitive); other extensions fail with `INVALID_TEMPLATE` before parsing. `--template` is relative to workspace `bin/templates`; output defaults to `notes` inside the active project, or workspace when none is selected. `--out` overrides that output directory within the same scope. The title becomes the output filename, so path separators and unsafe names are rejected. New documents never overwrite existing files. Dry-run validates the rendered document and returns the complete text plus planned revision without writing or emitting file events.

Use `--values-from inputs/feature.json` instead of `--values` for large or shell-sensitive JSON input; the input path is relative to the active project, or workspace when none is selected. The two options are mutually exclusive. `--date <ISO timestamp>` supplies a reproducible clock for date/time substitutions. Configuration controls default date and time formats.

## Syntax and safe frontmatter

For example, save this as `bin/templates/feature.md` in the workspace (including when authoring it in Obsidian):

```md
---
title: "{{title}}"
created: {{date}}
owner: "{{owner}}"
status: draft
---
# {{title}}

Owner: {{owner}}
Created {{date:dddd, MMMM Do YYYY}} at {{time:HH:mm:ss}} UTC.

- [ ] Acceptance criteria
- [ ] Domain invariants
- [ ] Tests and documentation
```

`{{title}}`, `{{date}}` and `{{time}}` are reserved built-ins. Other names come from a JSON object passed through `--values` or `--values-from`; reserved names cannot be overridden. Inspection returns unique sorted variable expressions. Missing values fail with `UNKNOWN_TEMPLATE_VARIABLE`, so inspect first and supply every required value.

Date formatting uses Day.js in UTC. Default formats are `YYYY-MM-DD` and `HH:mm`; expressions such as `{{date:YYYY-MM-DD}}` specify their own format. `--date` accepts an ISO date or an ISO instant with an explicit timezone, for example `2026-10-07T14:05:06Z`.

A whole YAML scalar placeholder retains its JSON type whether quoted or unquoted: `tags: {{tags}}` with `{"tags":["engineering","review"]}` creates a YAML sequence. YAML AST serialization prevents user values from injecting new properties. A placeholder inside a larger string or Markdown body produces text; arrays and objects use compact JSON. Template body content stays intact except for substitutions. Placeholders are not allowed in YAML keys, comments, tags or anchor names.

Values are substituted once; replacement values containing `{{...}}` are not evaluated again. Templates do not execute JavaScript, arbitrary code expressions, or Obsidian Templater scripts. Review generated content and apply your project's checks after generation.
