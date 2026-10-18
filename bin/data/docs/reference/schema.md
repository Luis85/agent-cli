# Schema contract

[Documentation](../index.md) · Reference

`schema` publishes the machine-readable contract of the installed executable: every command's input, output and failure codes as JSON Schema 2020-12 documents, behavior annotations derived from command metadata, and the response envelope. Agents and tools can validate an invocation before running it and validate the response after it. The installed executable is the authority: plugins add their commands to the same document.

```sh
node bin/forge.js schema --json          # a compact index: command, generator and skill ids
node bin/forge.js schema read --json     # one command, with only the error codes it can report
node bin/forge.js schema --all --json    # the complete contract of every command
```

Start with `help` (also `forge` without arguments, `--help` and `-h`) for a compact index under 4 KB: `commands` maps each command id to the first sentence of its description (at most 76 characters; when many commands, such as those of user plugins, would push the index past 4 KB in the response language, every description is cut shorter, down to 24 characters), `mutating` lists the commands that can change files or external state, `globalOptions` lists the global flags and `next` points to the details. `make` lists the generators and `skills` the agent skills. Use `help <command>` for that command's usage, examples, options, positional arguments, errors and action details, including JSON input document schemas where declared. Help omits response schemas and the envelope; use `schema <command>` when you need those contracts, or `schema --all` for the complete installed inventory. `schema` alone returns only `name`, `version`, `apiVersion`, `node`, `dialect`, `commands` (`{id, description}`), `generators`, `skills` and `more`, so it stays small; the fields below describe the document of `schema <command>` and `schema --all`. See [command metadata](plugins.md#command-metadata) for how a command declares them.

## Document

| Field | Contents |
| --- | --- |
| `name`, `version`, `apiVersion`, `node` | The executable, its version, the envelope version (currently 1) and the supported Node range |
| `dialect` | `https://json-schema.org/draft/2020-12/schema`; every published schema declares it as `$schema` and has a `title` |
| `globalOptions` | The options every command accepts, with `type`, `description`, `enum` and `default`. An `--events` value outside its `enum` fails with `INVALID_OPTION_VALUE`; an unsupported `--lang` fails with `INVALID_LANGUAGE` |
| `envelope` | JSON Schema of every response; see [envelope](#envelope) |
| `eventOutput` | The `--events` levels and the default |
| `commands` | One [command contract](#command-contract) per registered command (one entry for `schema <command>`) |
| `commonErrors` | Codes any command can report besides its own: argument and option errors, configuration, path and scope errors, an invalid or stale saved project selection (`INVALID_PROJECT_CONTEXT`, `STALE_PROJECT_CONTEXT`), `WORKSPACE_BUSY`, `INVALID_RESULT` and `OPERATION_FAILED` |
| `generators`, `skills` | Registered generator ids with descriptions, and skill ids (omitted for `schema <command>`) |
| `errors` | `{code, exitCode, category, retryable, summary, plugin?}` for every built-in and plugin-registered code; for `schema <command>` only `commonErrors` and the command's own codes. Hints arrive with each failure as `error.hint`; see the [error catalog](errors.md) |

## Command contract

| Field | Contents |
| --- | --- |
| `id`, `description`, `usage` | The command id, what it does and its usage line |
| `options`, `args` | The declared options and positional arguments, as `help <command>` shows them |
| `inputSchema` | JSON Schema of one invocation `{args, options}`: positional arguments after the command id and the command's own options. A command with actions publishes one `oneOf` branch per action; see [command metadata](plugins.md#command-metadata). A string option or argument that holds or names a JSON document carries that document's schema as `contentMediaType: "application/json"` and `contentSchema`: the `edit --edits` list and the `apply` plan. The host enforces each option's `required` and `enum` before the command runs: a missing option fails with `MISSING_ARGUMENT`, another value with `INVALID_OPTION_VALUE` (`details` `{option, value, allowed}`). An option with `list: true` (`read --parts`) takes a comma-separated list of its `enum` values, with optional whitespace around each item; its `inputSchema` property carries the equivalent `pattern` instead of the `enum`, and any item outside the `enum` fails with `INVALID_OPTION_VALUE` |
| `outputSchema` | JSON Schema of `data` in a successful response, when the command declares one. An action may declare its own, published as `annotations.actions.<action>.outputSchema`; it replaces the command's for that action |
| `errors` | Codes the command reports itself, besides `commonErrors`: `make` lists its own and every registered generator's, each plugin command lists `PLUGIN_UNAVAILABLE`, and a command whose metadata or one of whose actions declares a `projectOption` (`read`, `read-many`, `stat`, `apply`, `webview`, `browser`, and `make` for `ui`, `stories` and `data-source`) lists the codes of naming a project: `INVALID_PROJECT_NAME`, `PROJECT_NOT_FOUND` and `INVALID_PROJECT`. These are derived from the metadata, so commands never list them by hand |
| `annotations` | Behavior hints derived from metadata; see [annotations](#annotations) |

Output schemas describe the documented fields and their types. Objects stay open, so a later version may add fields without breaking a validator; required fields and enumerations are part of the contract. These commands declare output schemas:

| Command | `data` |
| --- | --- |
| `read` | `{path, revision, bytes, document}`; `document` is one of Markdown `{kind: "markdown", content, properties, body?}`, Canvas/Base `{kind, data}`, text `{kind: "text", content}` or bytes `{kind, encoding: "base64", content}` |
| `read-many` / `stat` | `{files, bytes}`, each file a `read` result or a failure / one file's or folder's revision and size metadata |
| `list` | `{files: [{path, kind}], nextCursor?}` |
| `validate` | `{path, valid: true, kind, validation}` |
| `search` | `{hits: [{path, line, column, match, snippet, before?, after?, revision}], total, nextCursor?}` |
| `links out` / `back` / `unresolved` | `{path?, links \| backlinks, issues}` with each link's location, resolution status, target or reason |
| `links orphans` / `deadends` | `{files, issues}` |
| `project list` / `project current` | `{directory, projects, invalid}` / `{project}`, where a project is `{schemaVersion, name, type, directory}` or `null`, and `invalid` lists `{directory, code, reason}` for each project directory whose `.forge/project.json` is invalid, so the other projects stay listed |
| `project create` / `open` / `close` / `component` | The guarded batch `{dryRun, changes, preview?}` with `project` (`null` after `close`), plus `nextSteps` for `create` and `component` `{name, kind}` for `component` |
| `config` | `{path, root, config, sections}` |
| `schema` | This document |
| `skills list` / `skills show` | `{skills}` / `{id, path, content, files}`: the returned file (`SKILL.md`, or the `--file` path) and every file of the skill folder |
| `create`, `write`, `edit`, `properties`, `patch` | The guarded batch `{dryRun, changes: [{path, revision, operation, bytes, alreadyApplied?, diff?}], preview?}`; `operation` is `created`, `updated`, `deleted` or `unchanged` (the file already held the bytes, so nothing was written), `alreadyApplied: true` marks a retry whose change was already present, `diff` is the unified diff of a dry run (`null` for binary content) and `preview` the planned content of generated files. Mutating plugin actions that commit one batch publish the same shape with their own fields: `templates install`, `skills install`, the `init`, `create`, `import` and `export` actions of `components`, `interactions` and `data-sources`, and the backlog writes (`backlog init`, `add`, `move`, `ranks`, `set`, `depend`, `undepend`, `iteration add`/`assign`, `release add`/`join`/`mark-released`/`notes`) |
| `move` / `rename` | `{dryRun, from, to, kind, revision?, renames, changes, links: {updated, files, unrewritten}, alreadyApplied?}`; a retry whose move already happened reports `alreadyApplied: true` with no renames or changes |
| `delete` | `{dryRun, path, kind, revision?, permanent, trashPath, deleted, brokenLinks}`; `trashPath` is `null` with `--permanent` |
| `make <generator>` | A generator that returns a write plan without review modes (`entity`, `value-object`, `use-case`, `event`, `form`, `plugin`) publishes `{generator, dryRun, changes, preview?}`; `make document` adds `template`. A plugin's `run` generator may declare its own `output` |
| `apply` | `{dryRun, operations: [{index, op, path, …}], renames, changes, folders}`: one summary per plan operation (a move adds `to`, `kind` and `links`; a delete adds `kind`, `trashPath`, which is `null` when the plan created every file it deleted, and `brokenLinks`) and the one batch it committed or, with `--dry-run`, planned |
| `vault check` | `{findings: [{rule, severity, path, line, column, message, hint, suggestion?}], summary: {files, findings, error, warning, info}, rules: [{id, severity, findings}], skipped, strict}` |
| `vault tags` / `vault properties` | `{tags: [{tag, count, files}]}` / `{properties: [{name, count, empty, types, type, declared, conflicting, files?}], typesFile: {path, status}}` |
| `server`, `server start` / `stop` | `{running, stale, server, url, webviews, dryRun?, changed?}` |
| `webview inspect` / `publish` | `{id, source, destination, built, installed, revision, current, files, changed?, checked?, dryRun?, changes?}` |
| `browser status` / `validate` / `tutorial`, `browser install` / `screenshot` | The browser runtime, a validated or executed tutorial plan; see [browser](browser.md) |
| `update check` / `apply` | `{installedVersion, releaseVersion, available, revision, releaseUrl}` / `{installedVersion, releaseVersion, checksum, changed, dryRun, changes, revision, restartRequired}` |

## Annotations

`annotations` holds `scope`, `discovery` and `mutating` from the metadata, plus three hints named after MCP tool annotations. Each action repeats them for its own mode under `annotations.actions.<action>`; the command-level values summarize all modes.

| Hint | Meaning | Derived as |
| --- | --- | --- |
| `readOnlyHint` | The invocation never changes files or external state | `!mutating`; command level: no mode mutates |
| `destructiveHint` | A mutating invocation may replace or remove existing content | `true` for every mutating mode unless its metadata declares `destructive: false` (`create`, `setup`, `skills install`, `templates install`, `project create/open/close/component`, the `init`, `create`, `import` and `export` actions of `components`, `interactions` and `data-sources`, and the create-only generators `make document`, `form`, `entity`, `value-object`, `use-case`, `event` and `plugin`); always `false` when read-only; command level: any mode is destructive |
| `idempotentHint` | Repeating the identical invocation has no further effect | `true` when read-only, or when the mode requires `--if-match` (a repeat fails on the changed revision), unless the metadata declares `idempotent`; an optional `--if-match` counts for nothing, so such a mode is `false` unless it declares `idempotent: true`; command level: every mode is idempotent |

The hints describe the command's contract, not the outcome of one call: `delete --if-match` is destructive and idempotent, because a second identical call fails with `NOT_FOUND` or `CONFLICT` instead of deleting again. A repeat that finds its own result reports it without writing: a write of bytes the file already holds is `unchanged`, and a repeated `move` or `rename` reports `alreadyApplied` (see [retries](cli.md#retries-and-unchanged-writes)). `write`, `delete`, `move` and `rename` declare `idempotent: true` although their `--if-match` is optional in the schema: `write` requires it once the file exists, and the others require it for every real change. `claude agents create`, `claude hooks add`, `claude plugins write-asset`, `agents create` and `agents import` declare it for the same reason: their files need `--if-match` once they exist. Modes that converge declare it too, because the identical repeat finds the target state and reports no changes: `backlog set`, `move`, `depend`, `undepend` and `ranks`, `workflows sync`, `agents generate`, `templates install` and the library actions `init`, `create`, `import` and `export` (which skip or refuse existing definitions). Every bundled `make` generator declares `idempotent: true`: the scaffolds' `generate` plans only create files, so the repeat reports them `unchanged`, or fails with `CONFLICT` once they were edited, and the `run` generators (`document`, `ui`, `stories`, `data-source`) refuse or skip existing outputs the same way. A plugin's generator is non-idempotent unless it declares `idempotent: true`, because a `generate` plan whose `expectedRevision` is the current revision applies again on every repeat. Other modes stay non-idempotent: a repeated `backlog add`, `backlog init`, `backlog iteration add` or `backlog release add` creates another note, `backlog sync` exchanges changes with a remote tracker, and the `claude plugins`, `marketplaces` and `runtime` actions that run the installed CLI (such as `plugins install` or `runtime update`) depend on its state. The `tests/cli/idempotency-*.e2e.test.ts` files run every mutating mode twice, grouped by command family, and fail when a repeat disagrees with the declared hint; `tests/cli/idempotency.integration.test.ts` fails when a mutating mode has no probe. The hints concern workspace files: any invocation, read-only ones included, may refresh Forge's derived metadata cache in the workspace root's `.forge/cache`, which listings, revisions and events leave out. `apply` declares `idempotent: true`: every operation on a path that existed before the plan needs its `ifMatch`, so a repeat fails with `CONFLICT` (the first run changed those paths and created the others), or changes nothing again when the first run changed nothing. `vault` is read-only in every action. Commands that a plugin adds receive the same derived hints from their metadata.

## Envelope

`envelope` is a JSON Schema with two `oneOf` branches:

- success: `{ok: true, data, events, warnings, context?}`, where `data` follows the command's output schema;
- failure: `{ok: false, error: {code, message, hint?, retryable?, details?}, events, warnings, context?}`.

`context` is `{workspaceRoot, root, project}` with `project` the selected project or `null`; it is absent from `--version` output and from failures before the scope is resolved. `events` lists `{id, payload}` records selected by `--events`, and `warnings` lists `{code, message, details?}` objects ([warnings](errors.md#warnings)). See [output and errors](cli.md#output-and-errors).

## Validating

The schemas use only keywords of the JSON Schema 2020-12 vocabulary that any compliant validator understands: `type`, `properties`, `required`, `additionalProperties`, `items`, `prefixItems`, `minItems`, `maxItems`, `enum`, `const`, `oneOf`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `default`, `title` and `description`, plus the content annotations `contentMediaType` and `contentSchema`. Content annotations describe the JSON document a string holds or names and are not asserted by validators: validate a plan or an edit list against the `contentSchema` yourself before passing it, or let the command report `INVALID_PLAN` or `INVALID_INPUT` with `details.issues`. The test suite checks every published schema against the 2020-12 meta-schema with Ajv in strict mode and validates real responses of the commands above, including `apply --dry-run`, `edit --dry-run` and every `vault` action, against their output schemas.

```js
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
const contract = JSON.parse(execFileSync('node', ['bin/forge.js', 'schema', 'read', '--json'], { encoding: 'utf8' })).data;
const ajv = new Ajv2020({ strictTuples: false });
const validData = ajv.compile(contract.commands[0].outputSchema);
```

Plugin authors declare `output` on a command or action with the same keyword subset; registration rejects unsupported keywords with `INVALID_PLUGIN`.
