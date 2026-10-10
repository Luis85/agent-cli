/**
 * Single source of truth for built-in failure codes. The category fixes the process exit status;
 * `hint` names the next step an agent or user should take and `retryable` says whether repeating the
 * unchanged invocation later can succeed. Plugin-defined codes are outside this catalog.
 */
export type ErrorCategory = 'input' | 'conflict' | 'not-found' | 'busy' | 'drift' | 'runtime' | 'external' | 'interrupted';
export interface ErrorDefinition {
  readonly exitCode: number;
  readonly category: ErrorCategory;
  readonly summary: string;
  readonly hint: string;
  readonly retryable: boolean;
}

/** SIGTERM interruptions report 143 instead of the category's SIGINT status 130. */
export const categoryExitCodes = {
  input: 2, conflict: 2, 'not-found': 3, busy: 4, drift: 5, runtime: 1, external: 1, interrupted: 130,
} as const satisfies Record<ErrorCategory, number>;

const entry = (category: ErrorCategory, summary: string, hint: string, retryable = false): ErrorDefinition =>
  ({ exitCode: categoryExitCodes[category], category, summary, hint, retryable });
const claudeDefinitionHint = 'Fix the field named in the message, then rerun the command.';
const argumentsHint = 'Correct the arguments named in the message; run help <command> for usage.';

export const errorCatalog = {
  // Arguments, options and input
  UNKNOWN_COMMAND: entry('input', 'The command is not registered.', 'Run help or schema to list available commands, including enabled plugin commands.'),
  UNKNOWN_OPTION: entry('input', 'The option is not accepted by this command.', 'Run help <command> to list its options.'),
  MISSING_ARGUMENT: entry('input', 'A required argument or option value is missing.', argumentsHint),
  INVALID_ARGUMENT: entry('input', 'The arguments or option values are invalid for this command.', argumentsHint),
  DUPLICATE_OPTION: entry('input', 'An option was repeated or combined with its negation.', 'Pass each option once.'),
  INVALID_INPUT: entry('input', 'The input options are invalid or contradictory.', 'Use exactly one input source and the option combination named in the message.'),
  INPUT_REQUIRED: entry('input', '--stdin was requested without piped input.', 'Pipe the content into the command, or use --content or --from instead.'),
  INVALID_JSON: entry('input', 'The input is not valid JSON.', 'Pass a valid JSON value; quote it for your shell.'),
  INVALID_ENCODING: entry('input', 'The content is not valid in the required encoding.', 'Use valid UTF-8 text. For binary content use write or create with --stdin, --from or --encoding base64; edit and structured commands accept only UTF-8 text.'),
  INVALID_LANGUAGE: entry('input', 'The language is not supported.', 'Use --lang en or --lang de.'),
  INVALID_NAME: entry('input', 'The name does not follow the required naming rule.', 'Use the name format described in the message, for example PascalCase.'),
  INVALID_KEY: entry('input', 'The property key is reserved or unsafe.', 'Use a different property key.'),
  INVALID_RESULT: entry('runtime', 'The command returned data that cannot be serialized as JSON.', 'Inspect committed vault events and reread affected files before retrying; report the failing plugin command.'),
  OPERATION_FAILED: entry('runtime', 'An unexpected runtime or I/O error occurred.', 'Read the message, check the workspace state and reread affected files before retrying.'),
  // Paths, files and guarded writes
  INVALID_PATH: entry('input', 'The path is not a valid workspace-relative path.', 'Use a relative path inside the selected workspace or project, with forward slashes and no .. segments.'),
  UNSAFE_PATH: entry('input', 'The path leaves the workspace or crosses a symbolic link.', 'Use a path inside the workspace that does not traverse symbolic links.'),
  NOT_FOUND: entry('not-found', 'The file or resource does not exist.', 'Check the path and the selected project (project current); run list to find files.'),
  CONFLICT: entry('conflict', 'The file already exists or its revision changed since it was read.', 'Reread the file and reconcile your change with the current content (error.details.currentRevision), then retry with the command\'s revision guard (--if-match or --revisions-from); create only adds new paths.'),
  NO_MATCH: entry('input', 'The --find text does not occur in the file.', 'Read the file again and copy the exact current text into --find, including whitespace and line endings.'),
  AMBIGUOUS_EDIT: entry('input', 'The --find text occurs more than once, counting overlapping matches.', 'Extend --find with surrounding text so it matches exactly once; error.details.lines lists the matching lines.'),
  UNSUPPORTED_EDIT: entry('input', 'This edit is not supported for the file kind.', 'Use edit for Markdown and text, properties for frontmatter, patch for Canvas and Bases, and write for attachments.'),
  INVALID_PLAN: entry('input', 'The write batch contains duplicate or overlapping paths.', 'Write each path once and do not write a file where another write needs a directory.'),
  WORKSPACE_BUSY: entry('busy', 'Another Forge writer holds the workspace lock or a backlog sync lock.', 'Wait and retry. If error.details.stale is "likely" (same host, pid namespace and boot; the pid no longer runs), inspect the holder\'s changes, confirm no Forge writer runs, then delete the lock file. If "unknown", verify the holder in error.details.lock yourself first.', true),
  DESTINATION_EXISTS: entry('conflict', 'The move or rename destination already exists.', 'Choose a destination that does not exist (error.details.path), or move or delete the existing file first; Forge never overwrites a destination.'),
  PROTECTED_PATH: entry('input', 'The path is protected from moves and deletion.', 'Forge never moves or deletes .obsidian, .forge or, at workspace scope, bin (in any letter case), nor a folder holding a .git repository; it permanently deletes only folders without symlinks, node_modules or special files, so move such a folder to the trash instead. The scope root and .git paths are refused as INVALID_PATH.'),
  INVALID_MOVE: entry('input', 'The move or rename is not possible.', 'Use a destination that differs from the source and is not inside it; rename takes a new name without slashes.'),
  HAS_BACKLINKS: entry('conflict', 'Other notes still link to the file or folder.', 'Update or remove the links in error.details.backlinks first, move the file instead, or pass --allow-broken-links to delete anyway.'),
  ROLLBACK_FAILED: entry('runtime', 'A failed write could not restore every file.', 'Inspect the files named in the message and repair them before retrying.'),
  // Documents
  INVALID_FRONTMATTER: entry('input', 'The YAML frontmatter is invalid.', 'Fix the frontmatter so it is a YAML mapping, then validate the note.'),
  INVALID_YAML: entry('input', 'The YAML document is invalid.', 'Fix the YAML syntax, keys or aliases named in the message.'),
  INVALID_CANVAS: entry('input', 'The Canvas structure is invalid.', 'Fix the nodes, edges or ids named in the message; run validate <file.canvas>.'),
  INVALID_BASE: entry('input', 'The Base structure is invalid.', 'Fix the Base definition named in the message; run validate <file.base>.'),
  INVALID_POINTER: entry('input', 'The JSON Pointer is invalid or does not address a valid location.', 'Read the document and use an existing pointer path; /- appends only to an existing array.'),
  // Bases queries
  INVALID_BASE_QUERY: entry('input', 'The Bases query is invalid.', 'Check the view, context and expressions named in the message.'),
  INVALID_BASE_EXPRESSION: entry('input', 'A Bases expression cannot be parsed.', 'Fix the expression named in the message.'),
  BASE_EVALUATION_ERROR: entry('input', 'A Bases expression failed while evaluating a file.', 'Check the view, file and expression named in the message.'),
  BASE_VIEW_NOT_FOUND: entry('input', 'The requested Bases view does not exist.', 'Run bases inspect <file.base> and pass an existing --view.'),
  BASE_CONTEXT_NOT_FOUND: entry('input', 'The context file is not an indexed vault file.', 'Pass an existing vault file to --context.'),
  INVALID_BASE_PROPERTY_TYPES: entry('input', 'The Obsidian property type registry is invalid.', 'Fix .obsidian/types.json so it is a JSON object of property types.'),
  UNSUPPORTED_BASE_PROPERTY_TYPE: entry('input', 'An Obsidian property type is not supported.', 'Use a supported type in .obsidian/types.json.'),
  // Configuration, setup and projects
  INVALID_CONFIG: entry('input', 'The configuration is invalid or unreadable.', 'Fix bin/config.json at the location named in the message, then run config.'),
  INVALID_SETUP: entry('input', 'Setup cannot complete with the current distribution files.', 'Repair the bin path named in the message, then run setup again.'),
  INVALID_PROJECT: entry('input', 'The project metadata is invalid.', 'Fix .forge/project.json in the project directory.'),
  INVALID_PROJECT_NAME: entry('input', 'The project name is invalid.', 'Use a lowercase kebab-case name, for example billing-service.'),
  INVALID_PROJECT_CONTEXT: entry('input', 'The saved project selection is invalid.', 'Run project open <name> or project close.'),
  INVALID_COMPONENT_KIND: entry('input', 'The component kind is invalid.', 'Use domain or application.'),
  PROJECT_EXISTS: entry('conflict', 'The project already exists.', 'Choose another name or run project open <name>.'),
  PROJECT_NOT_FOUND: entry('not-found', 'The project does not exist.', 'Run project list and open an existing project.'),
  PROJECT_REQUIRED: entry('input', 'This command needs a selected project.', 'Run project open <name> first.'),
  STALE_PROJECT_CONTEXT: entry('not-found', 'The selected project is missing or no longer matches the configuration.', 'Run project open <name> to select a valid project, or project close.'),
  // Templates and generation
  INVALID_TEMPLATE: entry('input', 'The Markdown template is invalid.', 'Fix the template frontmatter or placeholders named in the message.'),
  INVALID_TEMPLATE_DATE: entry('input', 'A template date or date format is invalid.', 'Use an ISO date and a supported date format.'),
  INVALID_TEMPLATE_PACK: entry('input', 'The template pack is invalid.', 'Use unique template ids and destinations.'),
  INVALID_TEMPLATE_VALUES: entry('input', 'Template values are missing or have the wrong type.', 'Run templates inspect <template.md> and supply its required values.'),
  UNKNOWN_TEMPLATE_VARIABLE: entry('input', 'The template uses an undeclared variable.', 'Declare the variable in the template or remove the placeholder; run templates inspect <template.md>.'),
  UNKNOWN_GENERATOR: entry('input', 'The generator is not registered.', 'Run make to list generators.'),
  INVALID_GENERATION_PLAN: entry('input', 'The generation plan has overlapping outputs or invalid options.', 'Use separate output and manifest paths, and do not combine planning with --revisions-from.'),
  INVALID_GENERATION_REVISIONS: entry('input', 'The revision approval does not match the reviewed plan.', 'Create a new plan with --plan-out and pass that file to --revisions-from.'),
  UI_DRIFT: entry('drift', 'Generated UI files are missing or differ from their definitions.', 'Run the same command with --plan to review, then regenerate.'),
  DATA_SOURCE_DRIFT: entry('drift', 'Generated data-source files are missing or differ from their definitions.', 'Run the same command with --plan to review, then regenerate.'),
  GENERATION_DRIFT: entry('drift', 'Generated files are missing or differ from what the generator produces.', 'Run the same make command with --plan to review, then regenerate.'),
  // Project workflows
  INVALID_WORKFLOW: entry('input', 'An authored project workflow is invalid or two workflows generate the same file.', 'Fix or rename the workflow under src/infrastructure/workflows/<concern>/ named in the message, then run workflows sync.'),
  WORKFLOW_DRIFT: entry('drift', 'Generated GitHub workflows are missing, changed or stale.', 'Run workflows sync, review the changes in .github/workflows and commit them with their sources.'),
  // UI, interactions and data sources
  INVALID_UI: entry('input', 'A component definition is invalid.', 'Fix the definition named in the message; run components validate.'),
  INVALID_UI_LIBRARY: entry('input', 'The component library is invalid.', 'Run components validate and fix the reported definitions.'),
  INVALID_UI_FRAMEWORK: entry('input', 'The UI target is not supported.', 'Use html, htmx, vanilla, vue, svelte, react or angular.'),
  EMPTY_UI_LIBRARY: entry('input', 'The component library has no definitions.', 'Run components init or add a Markdown definition.'),
  DUPLICATE_UI_COMPONENT: entry('input', 'Two component definitions share an id.', 'Give each component a unique id.'),
  UNKNOWN_UI_COMPONENT: entry('input', 'The component is not defined.', 'Run components list and use an existing id.'),
  CYCLIC_UI_COMPONENT: entry('input', 'Component references form a cycle.', 'Remove the cyclic reference named in the message.'),
  UI_RENDERER_UNAVAILABLE: entry('input', 'No renderer is available for this UI target.', 'Choose a supported --framework.'),
  INVALID_INTERACTION: entry('input', 'An interaction definition is invalid.', 'Fix the event, actions or bindings named in the message; run interactions validate.'),
  DUPLICATE_INTERACTION: entry('input', 'Two interaction definitions share an id.', 'Give each interaction a unique id.'),
  EMPTY_INTERACTION_LIBRARY: entry('input', 'The interaction library has no definitions.', 'Run interactions init or add a Markdown definition.'),
  UNKNOWN_INTERACTION: entry('input', 'The interaction is not defined.', 'Run interactions list and check the component\'s interaction references.'),
  INVALID_DATA_SOURCE: entry('input', 'A data-source definition is invalid.', 'Fix the fields named in the message; run data-sources validate.'),
  DUPLICATE_DATA_SOURCE: entry('input', 'Two data-source definitions share an id.', 'Give each data source a unique id.'),
  EMPTY_DATA_SOURCE_LIBRARY: entry('input', 'The data-source library has no definitions.', 'Run data-sources init or add a Markdown definition.'),
  UNKNOWN_DATA_SOURCE: entry('input', 'The data source is not defined.', 'Run data-sources list and use an existing id.'),
  DATA_SOURCE_RENDERER_UNAVAILABLE: entry('input', 'No generator is available for this data source.', 'Use a supported data-source kind; run help make for data-source generation.'),
  // Plugins, skills and events
  INVALID_PLUGIN: entry('input', 'A plugin manifest or implementation is invalid.', 'Fix the plugin named in the message, or disable it with --no-plugins.'),
  INVALID_PLUGIN_CONFIG: entry('input', 'The plugin configuration is invalid.', 'List unique lowercase kebab-case ids of installed user plugins in plugins.enabled in bin/config.json; run plugins to list them.'),
  INCOMPATIBLE_PLUGIN: entry('input', 'The plugin requires a newer Forge version.', 'Update The Forge or disable the plugin.'),
  DUPLICATE_PLUGIN: entry('input', 'The plugin is registered twice.', 'Enable each plugin once.'),
  PLUGIN_NAMESPACE: entry('input', 'A plugin id or contribution is outside its namespace.', 'Prefix user plugin command, generator, skill and event ids, and the service ids of every plugin, with the plugin id and a dot and error codes with its id in UPPER_SNAKE_CASE; do not use a host event namespace (command, operation, claude, vault, metadataCache, workspace, plugin) as the plugin id or claim core: true outside the bundle, and do not declare the options make owns (out, plan, plan-out, check, revisions-from) on a generator.'),
  PLUGIN_SERVICE_MISSING: entry('input', 'A plugin requires a service that no enabled plugin provides, or uses one it did not declare.', 'Enable the plugin that provides the service named in error.details.service (plugins lists providers), or declare it in the plugin\'s requires.'),
  PLUGIN_UNAVAILABLE: entry('input', 'The command or generator belongs to a plugin that is unavailable in this invocation.', 'error.details.reason says why: fix the plugins.settings problems listed in error.details.issues in bin/config.json, or enable the disabled provider it names (remove it from plugins.disabled), then rerun. Run plugins to see each plugin\'s state and reason.'),
  PLUGIN_SERVICE_CYCLE: entry('input', 'Plugin service requirements form a cycle.', 'Break the cycle named in error.details.plugins so that one plugin no longer requires a service of another.'),
  PLUGIN_LIFECYCLE: entry('input', 'A plugin used the host outside its lifecycle.', 'Register contributions before activation and stop using the host after disposal.'),
  DUPLICATE_OR_INVALID_ID: entry('input', 'A contribution id is invalid or already registered.', 'Use a unique lowercase dotted id.'),
  UNKNOWN_SKILL: entry('input', 'The skill is not registered.', 'Run skills list.'),
  INVALID_EVENT: entry('input', 'An event definition or event state is invalid.', 'Define events with a dotted id and validator before disposal.'),
  INVALID_EVENT_LISTENER: entry('input', 'An event listener is not a function.', 'Pass a function as the listener.'),
  INVALID_EVENT_PAYLOAD: entry('input', 'The event payload does not match its contract.', 'Run events and emit a payload that matches the contract.'),
  DUPLICATE_EVENT: entry('input', 'The event id is already registered.', 'Use a unique event id.'),
  UNKNOWN_EVENT: entry('input', 'The event is not registered.', 'Run events to list registered event ids.'),
  EVENT_RECURSION: entry('input', 'Event handlers recursed too deeply.', 'Stop handlers from emitting the events that trigger them.'),
  EVENT_OWNERSHIP: entry('input', 'A plugin tried to emit an event it does not own.', 'Emit only events in your plugin\'s own namespace; host events (vault.*, metadataCache.*, workspace.*, operation.*, command.*, plugin.*, claude.*) are emitted by the host.'),
  // Claude Code definitions
  INVALID_CLAUDE_AGENT: entry('input', 'The Claude agent definition is invalid.', claudeDefinitionHint),
  INVALID_CLAUDE_HOOKS: entry('input', 'The Claude hook configuration is invalid.', claudeDefinitionHint),
  INVALID_CLAUDE_PLUGIN: entry('input', 'The Claude plugin manifest or a plugin file is invalid.', claudeDefinitionHint),
  INVALID_CLAUDE_SETTINGS: entry('input', 'The Claude settings file is invalid.', 'Fix the JSON structure of the settings file named in the message.'),
  INVALID_CLAUDE_COMMAND: entry('input', 'The Claude command is not supported.', 'Run claude capabilities.'),
  INVALID_CLAUDE_ARGUMENT: entry('input', 'A Claude command argument is invalid.', argumentsHint),
  INVALID_CLAUDE_OPTION: entry('input', 'The option is not allowed for this Claude command.', 'Run help claude and remove the option.'),
  INVALID_CLAUDE_SCOPE: entry('input', 'The Claude scope is invalid.', 'Run help claude and pass a --scope value supported by that action.'),
  INVALID_CLAUDE_INPUT: entry('input', 'The Claude input is invalid or too large.', 'Pass valid input within the size limit.'),
  INVALID_CLAUDE_OUTPUT: entry('input', 'The Claude output format is invalid.', 'Use text, json or json-last-line.'),
  INVALID_CLAUDE_OUTPUT_LIMIT: entry('input', 'The Claude output limit is invalid.', 'Use a positive integer number of bytes.'),
  INVALID_CLAUDE_TIMEOUT: entry('input', 'The Claude timeout is invalid.', 'Pass the timeout in milliseconds within the range named in the message.'),
  INVALID_CLAUDE_EXECUTABLE: entry('input', 'The Claude executable path is invalid.', 'Pass an executable path to --claude-bin.'),
  // Claude Code process
  CLAUDE_NOT_INSTALLED: entry('external', 'The Claude Code executable was not found.', 'Install Claude Code and put claude on PATH, or pass --claude-bin.'),
  CLAUDE_WORKING_DIRECTORY_UNAVAILABLE: entry('external', 'The Claude working directory is unavailable.', 'Check that the selected project or workspace root exists and is a directory.'),
  CLAUDE_COMMAND_FAILED: entry('external', 'Claude Code could not be started or stopped unexpectedly.', 'Read error.details, inspect external state, then retry deliberately.'),
  CLAUDE_COMMAND_TIMEOUT: entry('external', 'The Claude command exceeded its timeout.', 'Inspect external state; retry with a larger --timeout only if the work did not complete.'),
  CLAUDE_OUTPUT_LIMIT: entry('external', 'Claude output exceeded the size limit.', 'Inspect external state; retry with a larger output limit only if needed.'),
  CLAUDE_COMMAND_INTERRUPTED: entry('interrupted', 'The Claude command was interrupted by a signal (exit 130 for SIGINT, 143 for SIGTERM).', 'Inspect external state before running the command again.'),
  CLAUDE_RUNTIME_FAILED: entry('external', 'Claude Code exited with a nonzero status.', 'Inspect error.details (native status, output and parsed result) and external state before retrying.'),
  CLAUDE_INVALID_OUTPUT: entry('external', 'Claude Code succeeded but did not return the requested JSON.', 'Inspect stdout and external state before retrying.'),
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof errorCatalog;
export const errorCodes = Object.keys(errorCatalog) as ErrorCode[];
export function errorDefinition(code: string): ErrorDefinition | undefined {
  return Object.hasOwn(errorCatalog, code) ? errorCatalog[code as ErrorCode] : undefined;
}
