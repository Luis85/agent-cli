# Make precise edits

[Documentation](../index.md) · How-to guide

Change exactly the part of a note you mean, and change several files as one unit, without rewriting whole files. Every command below is guarded by the revision you read, previews a unified diff with `--dry-run`, and writes nothing when any part fails. The exact contracts are in the [CLI reference](../reference/cli.md#precise-edits).

## Edit one section of a note

Read the note to get its revision and its headings:

```sh
node bin/forge.js read notes/plan.md --json
```

Address a section by its heading path, outermost heading first, separated by ` > `. Preview, then repeat without `--dry-run`:

```sh
node bin/forge.js edit notes/plan.md --section "Plan > Risks" --append --content "- Staffing" --if-match REVISION --dry-run
node bin/forge.js edit notes/plan.md --section "Plan > Risks" --append --content "- Staffing" --if-match REVISION
```

`--prepend --content` inserts before the section's first line, and `--replace TEXT` replaces its content. The heading line stays, and so do the blank lines around the content. When the path matches no heading, `SECTION_NOT_FOUND` lists the note's heading paths in `error.details.headings`; when it matches several, `AMBIGUOUS_SECTION` lists them in `error.details.candidates`, so add an ancestor heading.

## Edit a block

A paragraph or list item ending with `^id`, or a table followed by a `^id` line, is a block. Replace it and keep the marker that links point to:

```sh
node bin/forge.js edit notes/plan.md --block ship --replace "Ship the beta in May." --if-match REVISION
```

## Make several replacements at once

Put the replacements in order into a JSON list. Each one sees the result of the previous one; `all: true` replaces every occurrence:

```sh
node bin/forge.js edit src/config.ts --edits '[{"find":"retries: 3","replace":"retries: 5"},{"find":"TODO","replace":"DONE","all":true}]' --if-match REVISION --dry-run
```

Pass `--edits @edits.json` to read the list from a file in the scope, or `--edits -` to pipe it in. When one replacement fails, `error.details.edit` names it and nothing is written.

## Change several files as one unit

Write a plan with the operations in the order they should happen. Take each `ifMatch` from a `read` before the plan:

```json
{"version":1,"operations":[
  {"op":"edit","path":"notes/plan.md","section":"Plan > Risks","append":"- Staffing","ifMatch":"REVISION"},
  {"op":"frontmatter","path":"notes/plan.md","set":{"status":"active"}},
  {"op":"move","from":"notes/plan.md","to":"specs/roadmap.md"},
  {"op":"write","path":"specs/README.md","content":"Start at [[roadmap]].\n"},
  {"op":"delete","path":"notes/scratch.md"}
]}
```

Preview the whole plan, review every diff in `data.changes`, then apply it:

```sh
node bin/forge.js apply plan.json --dry-run
node bin/forge.js apply plan.json
cat plan.json | node bin/forge.js apply -
```

The move rewrites every link to the note, including links in files the plan wrote earlier. The plan commits as one batch: other notes never see half of it, a failure rolls it back, and listeners receive one set of `vault.*` and `metadataCache.*` records. Run `help apply` for the plan's JSON Schema.

## Recover from a failure

Match on `error.code`, and use `error.details.operation` (in a plan) or `error.details.edit` (in an edit list) to find the failing step:

- `CONFLICT`: the file changed since you read it. Read it again, rebuild the step from the current content and retry with the new revision.
- `NO_MATCH` or `AMBIGUOUS_EDIT`: copy the exact current text, or add surrounding text until it matches once.
- `SECTION_NOT_FOUND` or `AMBIGUOUS_SECTION`: choose a heading path from `error.details.headings` or `error.details.candidates`.
- `INVALID_PLAN`: fix the fields in `error.details.issues`, or split a plan that reuses a path it moves or deletes into two plans.
