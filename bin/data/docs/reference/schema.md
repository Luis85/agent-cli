# Schema contract

[Documentation](../index.md) · Reference

`schema` publishes the machine-readable contract of the installed executable: every command's input, output and failure codes as JSON Schema 2020-12 documents, behavior annotations derived from command metadata, and the response envelope. Agents and tools can validate an invocation before running it and validate the response after it. The installed executable is the authority: plugins add their commands to the same document.

```sh
node bin/forge.js schema --json          # the complete contract
node bin/forge.js schema read --json     # one command, with only the error codes it can report
```

`help` and `help <command>` return the same command descriptions without `inputSchema`; see [command metadata](plugins.md#command-metadata) for how a command declares them.

## Document

| Field | Contents |
| --- | --- |
| `name`, `version`, `apiVersion`, `node` | The executable, its version, the envelope version (currently 1) and the supported Node range |
| `dialect` | `https://json-schema.org/draft/2020-12/schema`; every published schema declares it as `$schema` and has a `title` |
| `globalOptions` | The options every command accepts, with `type`, `description`, `enum` and `default` |
| `envelope` | JSON Schema of every response; see [envelope](#envelope) |
| `eventOutput` | The `--events` levels and the default |
| `commands` | One [command contract](#command-contract) per registered command (one entry for `schema <command>`) |
| `commonErrors` | Codes any command can report besides its own: argument and option errors, configuration, path and scope errors, `WORKSPACE_BUSY`, `INVALID_RESULT` and `OPERATION_FAILED` |
| `generators`, `skills` | Registered generator ids with descriptions, and skill ids (omitted for `schema <command>`) |
| `errors` | `{code, exitCode, category, retryable, summary, plugin?}` for every built-in and plugin-registered code; for `schema <command>` only `commonErrors` and the command's own codes. Hints arrive with each failure as `error.hint`; see the [error catalog](errors.md) |

## Command contract

| Field | Contents |
| --- | --- |
| `id`, `description`, `usage` | The command id, what it does and its usage line |
| `options`, `args` | The declared options and positional arguments, as `help` shows them |
| `inputSchema` | JSON Schema of one invocation `{args, options}`: positional arguments after the command id and the command's own options. A command with actions publishes one `oneOf` branch per action; see [command metadata](plugins.md#command-metadata). A string option or argument that holds or names a JSON document carries that document's schema as `contentMediaType: "application/json"` and `contentSchema`: the `edit --edits` list and the `apply` plan |
| `outputSchema` | JSON Schema of `data` in a successful response, when the command declares one. An action may declare its own, published as `annotations.actions.<action>.outputSchema`; it replaces the command's for that action |
| `errors` | Codes the command reports itself, besides `commonErrors` |
| `annotations` | Behavior hints derived from metadata; see [annotations](#annotations) |

Output schemas describe the documented fields and their types. Objects stay open, so a later version may add fields without breaking a validator; required fields and enumerations are part of the contract. These commands declare output schemas:

| Command | `data` |
| --- | --- |
| `read` | `{path, revision, bytes, document}`; `document` is one of Markdown `{kind: "markdown", content, properties, body?}`, Canvas/Base `{kind, data}`, text `{kind: "text", content}` or bytes `{kind, encoding: "base64", content}` |
| `list` | `{files: [{path, kind}], nextCursor?}` |
| `validate` | `{path, valid: true, kind, validation}` |
| `search` | `{hits: [{path, line, column, match, snippet, before?, after?, revision}], total, nextCursor?}` |
| `links out` / `back` / `unresolved` | `{path?, links \| backlinks, issues}` with each link's location, resolution status, target or reason |
| `links orphans` / `deadends` | `{files, issues}` |
| `project list` / `project current` | `{directory, projects}` / `{project}`, where a project is `{schemaVersion, name, type, directory}` or `null` |
| `config` | `{path, root, config, sections}` |
| `schema` | This document |
| `skills list` / `skills show` | `{skills}` / `{id, content}` |
| `edit` | `{dryRun, changes: [{path, revision, operation, bytes, diff?}]}`; `diff` is the unified diff of a dry run (`null` for binary content) |
| `apply` | `{dryRun, operations: [{index, op, path, …}], renames, changes, folders}`: one summary per plan operation (a move adds `to`, `kind` and `links`; a delete adds `kind`, `trashPath` and `brokenLinks`) and the one batch it committed or, with `--dry-run`, planned |
| `vault check` | `{findings: [{rule, severity, path, line, column, message, hint, suggestion?}], summary: {files, findings, error, warning, info}, rules: [{id, severity, findings}], skipped, strict}` |
| `vault tags` / `vault properties` | `{tags: [{tag, count, files}]}` / `{properties: [{name, count, empty, types, type, declared, conflicting, files?}], typesFile: {path, status}}` |

## Annotations

`annotations` holds `scope`, `discovery` and `mutating` from the metadata, plus three hints named after MCP tool annotations. Each action repeats them for its own mode under `annotations.actions.<action>`; the command-level values summarize all modes.

| Hint | Meaning | Derived as |
| --- | --- | --- |
| `readOnlyHint` | The invocation never changes files or external state | `!mutating`; command level: no mode mutates |
| `destructiveHint` | A mutating invocation may replace or remove existing content | `true` for every mutating mode unless its metadata declares `destructive: false` (`create`, `setup`, `skills install`, `project create/open/close/component`); always `false` when read-only; command level: any mode is destructive |
| `idempotentHint` | Repeating the identical invocation has no further effect | `true` when read-only, or when the mode declares `--if-match` (a repeat fails on the changed revision), unless the metadata declares `idempotent`; command level: every mode is idempotent |

The hints describe the command's contract, not the outcome of one call: `delete --if-match` is destructive and idempotent, because a second identical call fails with `NOT_FOUND` or `CONFLICT` instead of deleting again. `apply` declares `idempotent: false`: each operation's `ifMatch` is optional, and an operation without one, such as an `edit` append, applies again on a repeat; a plan whose every operation carries `ifMatch` fails with `CONFLICT` instead. `vault` is read-only in every action. Commands that a plugin adds receive the same derived hints from their metadata.

## Envelope

`envelope` is a JSON Schema with two `oneOf` branches:

- success: `{ok: true, data, events, warnings, context?}`, where `data` follows the command's output schema;
- failure: `{ok: false, error: {code, message, hint?, retryable?, details?}, events, warnings, context?}`.

`context` is `{workspaceRoot, root, project}` with `project` the selected project or `null`; it is absent from `--version` output and from failures before the scope is resolved. `events` lists `{id, payload}` records selected by `--events`, and `warnings` lists strings. See [output and errors](cli.md#output-and-errors).

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
