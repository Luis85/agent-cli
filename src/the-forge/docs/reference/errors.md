# Error catalog

[Documentation](../index.md) · Reference

Every built-in failure has a stable `code` from this catalog. The catalog is the single source of exit statuses, categories, retryability and recovery hints. `node bin/app.js schema --json` lists it at `data.errors` as `{code, exitCode, category, retryable, summary}`, so agents can discover it from the installed executable. A test fails when Forge source throws a code missing here, or when a catalogued code is no longer thrown.

## Failure envelope

```json
{"ok":false,"error":{"code":"NO_MATCH","message":"The find text does not occur in the file. Read it again and copy the exact current text.","hint":"Read the file again and copy the exact current text into --find, including whitespace and line endings.","retryable":false,"details":{"find":"Draft","matches":0}},"events":[],"warnings":[]}
```

| Field | Meaning |
| --- | --- |
| `code` | Stable machine identifier. Match on it, never on `message` |
| `message` | The original diagnostic in English, or the translated summary with `--lang de` |
| `hint` | The next step to take. Present for every catalogued code |
| `retryable` | `true` when repeating the unchanged invocation later can succeed. Only `WORKSPACE_BUSY` is retryable; every other failure needs a changed request or inspected state |
| `details` | Optional structured data, documented per code below |

Plugin-defined codes are not in this catalog. They keep their own shape, without `hint` or `retryable`. A thrown value that is not a Forge error becomes `OPERATION_FAILED`. With `--lang de`, `message` and `hint` are German, `code`, `retryable` and `details` stay unchanged, and the original diagnostic moves to `details.localization.originalMessage`. See [CLI language](language.md).

## Exit statuses

| Category | Exit | Meaning |
| --- | --- | --- |
| success | 0 | `ok:true` |
| `runtime` | 1 | Unexpected runtime, I/O or plugin failure |
| `external` | 1 | Claude Code could not run or failed |
| `input` | 2 | Invalid arguments, definitions or edit requests |
| `conflict` | 2 | The target exists or changed since it was read |
| `not-found` | 3 | A file, project or selected project is missing |
| `busy` | 4 | Another Forge writer holds the workspace lock |
| `drift` | 5 | Generated UI, data-source or workflow output differs from its sources |
| `interrupted` | 130 | Claude Code was interrupted by SIGINT; SIGTERM reports 143 |

## Recovering edits and guarded writes

**`NO_MATCH`** (exit 2): the `edit --find` text does not occur in the file. `details` is `{find, matches: 0}`. Read the file again, because it may have changed, and copy the exact current text, including whitespace and line endings. Nothing was written.

**`AMBIGUOUS_EDIT`** (exit 2): the `--find` text occurs more than once, counting overlapping occurrences. `details.matches` is the total count, and `details.lines` lists the 1-based line of each match start, at most 20. Add surrounding text until the match is unique. Nothing was written. An empty `--find` fails with `INVALID_INPUT`.

**`CONFLICT`** (exit 2): the `--if-match` revision does not match the stored file, or a write would replace a file without its revision. Dry runs report the same conflict as the real write. `details` is:

| Field | Meaning |
| --- | --- |
| `path` | The first conflicting path, relative to `context.root` |
| `expectedRevision` | The revision the request supplied, or `null` when it supplied none |
| `currentRevision` | The stored file's revision, or `null` when the file does not exist |
| `conflicts` | Multi-file batches only: `{path, expectedRevision, currentRevision}` for every conflicting path |

`currentRevision` equals what a fresh `read` returns. Do not resend the old request with that revision unchanged: read the file, reapply the change to its current content, then retry through the command's revision guard: `--if-match` for file commands, or a reviewed `--plan-out` plan and `--revisions-from` for generation. `create` has no guard and only adds new paths; replace an existing file with `write --if-match`. `write`, `edit`, `properties`, `patch`, `create` over an existing file and native Claude settings updates report these details. Generation commands such as `make ui` keep the details and replace the message with planning guidance.

**`WORKSPACE_BUSY`** (exit 4, retryable): see the [write contract](cli.md#write-contract) for `details.lock` and `details.stale`.

## Codes

| Code | Exit | Category | Retryable | Summary | Hint |
| --- | --- | --- | --- | --- | --- |
| `UNKNOWN_COMMAND` | 2 | input | no | The command is not registered. | Run help or schema to list available commands, including enabled plugin commands. |
| `UNKNOWN_OPTION` | 2 | input | no | The option is not accepted by this command. | Run `help <command>` to list its options. |
| `MISSING_ARGUMENT` | 2 | input | no | A required argument or option value is missing. | Correct the arguments named in the message; run `help <command>` for usage. |
| `INVALID_ARGUMENT` | 2 | input | no | The arguments or option values are invalid for this command. | Correct the arguments named in the message; run `help <command>` for usage. |
| `DUPLICATE_OPTION` | 2 | input | no | An option was repeated or combined with its negation. | Pass each option once. |
| `INVALID_INPUT` | 2 | input | no | The input options are invalid or contradictory. | Use exactly one input source and the option combination named in the message. |
| `INPUT_REQUIRED` | 2 | input | no | `--stdin` was requested without piped input. | Pipe the content into the command, or use `--content` or `--from` instead. |
| `INVALID_JSON` | 2 | input | no | The input is not valid JSON. | Pass a valid JSON value; quote it for your shell. |
| `INVALID_ENCODING` | 2 | input | no | The content is not valid in the required encoding. | Use valid UTF-8 text. For binary content use `write` or `create` with `--stdin`, `--from` or `--encoding base64`; `edit` and structured commands accept only UTF-8 text. |
| `INVALID_LANGUAGE` | 2 | input | no | The language is not supported. | Use `--lang` en or `--lang` de. |
| `INVALID_NAME` | 2 | input | no | The name does not follow the required naming rule. | Use the name format described in the message, for example PascalCase. |
| `INVALID_KEY` | 2 | input | no | The property key is reserved or unsafe. | Use a different property key. |
| `INVALID_RESULT` | 1 | runtime | no | The command returned data that cannot be serialized as JSON. | Inspect committed vault events and reread affected files before retrying; report the failing plugin command. |
| `OPERATION_FAILED` | 1 | runtime | no | An unexpected runtime or I/O error occurred. | Read the message, check the workspace state and reread affected files before retrying. |
| `INVALID_PATH` | 2 | input | no | The path is not a valid workspace-relative path. | Use a relative path inside the selected workspace or project, with forward slashes and no `..` segments. |
| `UNSAFE_PATH` | 2 | input | no | The path leaves the workspace or crosses a symbolic link. | Use a path inside the workspace that does not traverse symbolic links. |
| `NOT_FOUND` | 3 | not-found | no | The file or resource does not exist. | Check the path and the selected project (project current); run list to find files. |
| `CONFLICT` | 2 | conflict | no | The file already exists or its revision changed since it was read. | Reread the file and reconcile your change with the current content (`error.details.currentRevision`), then retry with the command's revision guard (`--if-match` or `--revisions-from`); `create` only adds new paths. |
| `NO_MATCH` | 2 | input | no | The `--find` text does not occur in the file. | Read the file again and copy the exact current text into `--find`, including whitespace and line endings. |
| `AMBIGUOUS_EDIT` | 2 | input | no | The `--find` text occurs more than once, counting overlapping matches. | Extend `--find` with surrounding text so it matches exactly once; `error.details.lines` lists the matching lines. |
| `UNSUPPORTED_EDIT` | 2 | input | no | This edit is not supported for the file kind. | Use edit for Markdown and text, properties for frontmatter, patch for Canvas and Bases, and write for attachments. |
| `INVALID_PLAN` | 2 | input | no | The write batch contains duplicate or overlapping paths. | Write each path once and do not write a file where another write needs a directory. |
| `WORKSPACE_BUSY` | 4 | busy | yes | Another Forge writer holds the workspace lock. | Wait and retry. If `error.details.stale` is "likely" (same host, pid namespace and boot; the pid no longer runs), inspect the holder's changes, confirm no Forge writer runs, then delete the lock file. If "unknown", verify the holder in `error.details.lock` yourself first. |
| `ROLLBACK_FAILED` | 1 | runtime | no | A failed write could not restore every file. | Inspect the files named in the message and repair them before retrying. |
| `INVALID_FRONTMATTER` | 2 | input | no | The YAML frontmatter is invalid. | Fix the frontmatter so it is a YAML mapping, then validate the note. |
| `INVALID_YAML` | 2 | input | no | The YAML document is invalid. | Fix the YAML syntax, keys or aliases named in the message. |
| `INVALID_CANVAS` | 2 | input | no | The Canvas structure is invalid. | Fix the nodes, edges or ids named in the message; run `validate <file.canvas>`. |
| `INVALID_BASE` | 2 | input | no | The Base structure is invalid. | Fix the Base definition named in the message; run `validate <file.base>`. |
| `INVALID_POINTER` | 2 | input | no | The JSON Pointer is invalid or does not address a valid location. | Read the document and use an existing pointer path; `/-` appends only to an existing array. |
| `INVALID_BASE_QUERY` | 2 | input | no | The Bases query is invalid. | Check the view, context and expressions named in the message. |
| `INVALID_BASE_EXPRESSION` | 2 | input | no | A Bases expression cannot be parsed. | Fix the expression named in the message. |
| `BASE_EVALUATION_ERROR` | 2 | input | no | A Bases expression failed while evaluating a file. | Check the view, file and expression named in the message. |
| `BASE_VIEW_NOT_FOUND` | 2 | input | no | The requested Bases view does not exist. | Run `bases inspect <file.base>` and pass an existing `--view`. |
| `BASE_CONTEXT_NOT_FOUND` | 2 | input | no | The context file is not an indexed vault file. | Pass an existing vault file to `--context`. |
| `BASE_INDEX_ERROR` | 2 | input | no | A vault file could not be indexed. | Fix or validate the file named in the message. |
| `AMBIGUOUS_BASE_LINK` | 2 | input | no | An internal link matches several files. | Use a longer link path that identifies one file. |
| `INVALID_BASE_PROPERTY_TYPES` | 2 | input | no | The Obsidian property type registry is invalid. | Fix `.obsidian/types.json` so it is a JSON object of property types. |
| `UNSUPPORTED_BASE_PROPERTY_TYPE` | 2 | input | no | An Obsidian property type is not supported. | Use a supported type in `.obsidian/types.json`. |
| `INVALID_CONFIG` | 2 | input | no | The configuration is invalid or unreadable. | Fix `bin/config.json` at the location named in the message, then run config. |
| `INVALID_SETUP` | 2 | input | no | Setup cannot complete with the current distribution files. | Repair the bin path named in the message, then run setup again. |
| `INVALID_PROJECT` | 2 | input | no | The project metadata is invalid. | Fix `.forge/project.json` in the project directory. |
| `INVALID_PROJECT_NAME` | 2 | input | no | The project name is invalid. | Use a lowercase kebab-case name, for example billing-service. |
| `INVALID_PROJECT_CONTEXT` | 2 | input | no | The saved project selection is invalid. | Run `project open <name>` or project close. |
| `INVALID_COMPONENT_KIND` | 2 | input | no | The component kind is invalid. | Use domain or application. |
| `PROJECT_EXISTS` | 2 | conflict | no | The project already exists. | Choose another name or run `project open <name>`. |
| `PROJECT_NOT_FOUND` | 3 | not-found | no | The project does not exist. | Run project list and open an existing project. |
| `PROJECT_REQUIRED` | 2 | input | no | This command needs a selected project. | Run `project open <name>` first. |
| `STALE_PROJECT_CONTEXT` | 3 | not-found | no | The selected project is missing or no longer matches the configuration. | Run `project open <name>` to select a valid project, or project close. |
| `INVALID_TEMPLATE` | 2 | input | no | The Markdown template is invalid. | Fix the template frontmatter or placeholders named in the message. |
| `INVALID_TEMPLATE_DATE` | 2 | input | no | A template date or date format is invalid. | Use an ISO date and a supported date format. |
| `INVALID_TEMPLATE_PACK` | 2 | input | no | The template pack is invalid. | Use unique template ids and destinations. |
| `INVALID_TEMPLATE_VALUES` | 2 | input | no | Template values are missing or have the wrong type. | Run `templates inspect <template.md>` and supply its required values. |
| `UNKNOWN_TEMPLATE_VARIABLE` | 2 | input | no | The template uses an undeclared variable. | Declare the variable in the template or remove the placeholder; run `templates inspect <template.md>`. |
| `UNKNOWN_GENERATOR` | 2 | input | no | The generator is not registered. | Run make to list generators. |
| `INVALID_GENERATION_PLAN` | 2 | input | no | The generation plan has overlapping outputs or invalid options. | Use separate output and manifest paths, and do not combine planning with `--revisions-from`. |
| `INVALID_GENERATION_REVISIONS` | 2 | input | no | The revision approval does not match the reviewed plan. | Create a new plan with `--plan-out` and pass that file to `--revisions-from`. |
| `UI_DRIFT` | 5 | drift | no | Generated UI files are missing or differ from their definitions. | Run the same command with `--plan` to review, then regenerate. |
| `DATA_SOURCE_DRIFT` | 5 | drift | no | Generated data-source files are missing or differ from their definitions. | Run the same command with `--plan` to review, then regenerate. |
| `INVALID_WORKFLOW` | 2 | input | no | An authored project workflow is invalid or two workflows generate the same file. | Fix or rename the workflow under `src/infrastructure/workflows/<concern>/` named in the message, then run `workflows sync`. |
| `WORKFLOW_DRIFT` | 5 | drift | no | Generated GitHub workflows are missing, changed or stale. | Run `workflows sync`, review the changes in `.github/workflows` and commit them with their sources. |
| `INVALID_UI` | 2 | input | no | A component definition is invalid. | Fix the definition named in the message; run components validate. |
| `INVALID_UI_LIBRARY` | 2 | input | no | The component library is invalid. | Run components validate and fix the reported definitions. |
| `INVALID_UI_FRAMEWORK` | 2 | input | no | The UI target is not supported. | Use html, htmx, vanilla, vue, svelte, react or angular. |
| `EMPTY_UI_LIBRARY` | 2 | input | no | The component library has no definitions. | Run components init or add a Markdown definition. |
| `DUPLICATE_UI_COMPONENT` | 2 | input | no | Two component definitions share an id. | Give each component a unique id. |
| `UNKNOWN_UI_COMPONENT` | 2 | input | no | The component is not defined. | Run components list and use an existing id. |
| `CYCLIC_UI_COMPONENT` | 2 | input | no | Component references form a cycle. | Remove the cyclic reference named in the message. |
| `UI_RENDERER_UNAVAILABLE` | 2 | input | no | No renderer is available for this UI target. | Choose a supported `--framework`. |
| `INVALID_INTERACTION` | 2 | input | no | An interaction definition is invalid. | Fix the event, actions or bindings named in the message; run interactions validate. |
| `DUPLICATE_INTERACTION` | 2 | input | no | Two interaction definitions share an id. | Give each interaction a unique id. |
| `EMPTY_INTERACTION_LIBRARY` | 2 | input | no | The interaction library has no definitions. | Run interactions init or add a Markdown definition. |
| `UNKNOWN_INTERACTION` | 2 | input | no | The interaction is not defined. | Run interactions list and check the component's interaction references. |
| `INVALID_DATA_SOURCE` | 2 | input | no | A data-source definition is invalid. | Fix the fields named in the message; run data-sources validate. |
| `DUPLICATE_DATA_SOURCE` | 2 | input | no | Two data-source definitions share an id. | Give each data source a unique id. |
| `EMPTY_DATA_SOURCE_LIBRARY` | 2 | input | no | The data-source library has no definitions. | Run data-sources init or add a Markdown definition. |
| `UNKNOWN_DATA_SOURCE` | 2 | input | no | The data source is not defined. | Run data-sources list and use an existing id. |
| `DATA_SOURCE_RENDERER_UNAVAILABLE` | 2 | input | no | No generator is available for this data source. | Use a supported data-source kind; run help make for data-source generation. |
| `INVALID_PLUGIN` | 2 | input | no | A plugin manifest or implementation is invalid. | Fix the plugin named in the message, or disable it with `--no-plugins`. |
| `INVALID_PLUGIN_CONFIG` | 2 | input | no | The enabled plugin list is invalid. | List unique lowercase kebab-case plugin ids in plugins.enabled in `bin/config.json`. |
| `INCOMPATIBLE_PLUGIN` | 2 | input | no | The plugin requires a newer Forge version. | Update The Forge or disable the plugin. |
| `DUPLICATE_PLUGIN` | 2 | input | no | The plugin is registered twice. | Enable each plugin once. |
| `PLUGIN_NAMESPACE` | 2 | input | no | A plugin contribution is outside its namespace. | Prefix plugin command, generator, skill and event ids with the plugin id and a dot. |
| `PLUGIN_LIFECYCLE` | 2 | input | no | A plugin used the host outside its lifecycle. | Register contributions before activation and stop using the host after disposal. |
| `DUPLICATE_OR_INVALID_ID` | 2 | input | no | A contribution id is invalid or already registered. | Use a unique lowercase dotted id. |
| `UNKNOWN_SKILL` | 2 | input | no | The skill is not registered. | Run skills list. |
| `INVALID_EVENT` | 2 | input | no | An event definition or event state is invalid. | Define events with a dotted id and validator before disposal. |
| `INVALID_EVENT_LISTENER` | 2 | input | no | An event listener is not a function. | Pass a function as the listener. |
| `INVALID_EVENT_PAYLOAD` | 2 | input | no | The event payload does not match its contract. | Run events and emit a payload that matches the contract. |
| `DUPLICATE_EVENT` | 2 | input | no | The event id is already registered. | Use a unique event id. |
| `UNKNOWN_EVENT` | 2 | input | no | The event is not registered. | Run events to list registered event ids. |
| `EVENT_RECURSION` | 2 | input | no | Event handlers recursed too deeply. | Stop handlers from emitting the events that trigger them. |
| `INVALID_CLAUDE_AGENT` | 2 | input | no | The Claude agent definition is invalid. | Fix the field named in the message, then rerun the command. |
| `INVALID_CLAUDE_HOOKS` | 2 | input | no | The Claude hook configuration is invalid. | Fix the field named in the message, then rerun the command. |
| `INVALID_CLAUDE_PLUGIN` | 2 | input | no | The Claude plugin manifest or a plugin file is invalid. | Fix the field named in the message, then rerun the command. |
| `INVALID_CLAUDE_SETTINGS` | 2 | input | no | The Claude settings file is invalid. | Fix the JSON structure of the settings file named in the message. |
| `INVALID_CLAUDE_COMMAND` | 2 | input | no | The Claude command is not supported. | Run claude capabilities. |
| `INVALID_CLAUDE_ARGUMENT` | 2 | input | no | A Claude command argument is invalid. | Correct the arguments named in the message; run `help <command>` for usage. |
| `INVALID_CLAUDE_OPTION` | 2 | input | no | The option is not allowed for this Claude command. | Run help claude and remove the option. |
| `INVALID_CLAUDE_SCOPE` | 2 | input | no | The Claude scope is invalid. | Run help claude and pass a `--scope` value supported by that action. |
| `INVALID_CLAUDE_INPUT` | 2 | input | no | The Claude input is invalid or too large. | Pass valid input within the size limit. |
| `INVALID_CLAUDE_OUTPUT` | 2 | input | no | The Claude output format is invalid. | Use text, json or json-last-line. |
| `INVALID_CLAUDE_OUTPUT_LIMIT` | 2 | input | no | The Claude output limit is invalid. | Use a positive integer number of bytes. |
| `INVALID_CLAUDE_TIMEOUT` | 2 | input | no | The Claude timeout is invalid. | Pass the timeout in milliseconds within the range named in the message. |
| `INVALID_CLAUDE_EXECUTABLE` | 2 | input | no | The Claude executable path is invalid. | Pass an executable path to `--claude-bin`. |
| `CLAUDE_NOT_INSTALLED` | 1 | external | no | The Claude Code executable was not found. | Install Claude Code and put claude on PATH, or pass `--claude-bin`. |
| `CLAUDE_WORKING_DIRECTORY_UNAVAILABLE` | 1 | external | no | The Claude working directory is unavailable. | Check that the selected project or workspace root exists and is a directory. |
| `CLAUDE_COMMAND_FAILED` | 1 | external | no | Claude Code could not be started or stopped unexpectedly. | Read error.details, inspect external state, then retry deliberately. |
| `CLAUDE_COMMAND_TIMEOUT` | 1 | external | no | The Claude command exceeded its timeout. | Inspect external state; retry with a larger `--timeout` only if the work did not complete. |
| `CLAUDE_OUTPUT_LIMIT` | 1 | external | no | Claude output exceeded the size limit. | Inspect external state; retry with a larger output limit only if needed. |
| `CLAUDE_COMMAND_INTERRUPTED` | 130 | interrupted | no | The Claude command was interrupted by a signal (exit 130 for SIGINT, 143 for SIGTERM). | Inspect external state before running the command again. |
| `CLAUDE_RUNTIME_FAILED` | 1 | external | no | Claude Code exited with a nonzero status. | Inspect error.details (native status, output and parsed result) and external state before retrying. |
| `CLAUDE_INVALID_OUTPUT` | 1 | external | no | Claude Code succeeded but did not return the requested JSON. | Inspect stdout and external state before retrying. |
