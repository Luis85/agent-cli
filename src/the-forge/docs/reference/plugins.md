# Plugins and events

[Documentation](../index.md) · Reference

Plugins extend The Forge. There are two kinds, with one contract (plugin contract v2):

- **Core plugins** are bundled with the distribution under `src/plugins/<id>/` in the Forge source, like Obsidian's core plugins. They are enabled by default and can be disabled in configuration; see [bundled core plugins](#bundled-core-plugins).
- **User plugins** live in workspace `bin/plugins/<id>/` with a `manifest.json` and a `main.mjs` ESM entry point or `main.js` CommonJS entry point. They extend the distributed bundle without rebuilding it, and only run when `plugins.enabled` names them.

The host uses Obsidian-inspired packaging and lifecycle conventions; it does not run existing Obsidian plugins unchanged. Plugin authors compile TypeScript and bundle external dependencies before distribution. For installation steps, see [enable a plugin](../how-to/enable-plugins.md).

## Manifest

A user plugin's manifest contains:

```json
{
  "id": "quality",
  "name": "Quality checks",
  "version": "1.0.0",
  "minAppVersion": "0.1.0",
  "description": "Engineering checks and generators",
  "author": "Your team"
}
```

All fields are required. IDs use lowercase kebab-case and cannot be a host event namespace (`command`, `operation`, `vault`, `metadataCache`, `workspace`, `plugin`), which fails with `PLUGIN_NAMESPACE`; versions use numeric `major.minor.patch` without prerelease identifiers or leading zeros. The host rejects unsupported `minAppVersion` before executing plugins. Every enabled manifest is validated before the first entry point is loaded. `main.mjs` takes precedence; `main.js` uses CommonJS even inside an ESM project.

A core plugin's manifest also declares `"core": true`. Only bundled plugins may: a user manifest that declares `core` fails with `PLUGIN_NAMESPACE`, and a user plugin cannot reuse a core plugin's id (`DUPLICATE_PLUGIN`).

## Core and user plugins

| | Core plugins | User plugins |
| --- | --- | --- |
| Location | `src/plugins/<id>/plugin.ts` in the Forge source, bundled into `bin/forge.js` | Workspace `bin/plugins/<id>/` |
| Enabled | By default; `plugins.disabled: ["<id>"]` disables one | Only when `plugins.enabled` lists it, in that load order |
| `--no-plugins` | Still loaded: they are part of the product | Skipped for the invocation |
| Command, generator and skill ids | May be bare (`skills`, `search`) | Must start with `<id>.` |
| Service ids | `<id>.*` only (`bases.query`), so a service names its provider | `<id>.*` only |
| Event ids | `<id>.*` only, so a core plugin owns its namespace (`bases.*`) | `<id>.*` only |
| Error codes | Any code outside the built-in catalog | Must start with the id in UPPER_SNAKE_CASE (`QUALITY_`) and stay outside a longer registered prefix; see [strings and error codes](#strings-and-error-codes) |
| Registration | Bundle order, before user plugins | After core plugins |

A disabled core plugin contributes nothing: its commands are absent from `help` and `schema`, its skills from `skills` and `setup`, and its services from other plugins. `plugins.disabled` accepts only bundled core plugin ids; any other id is ignored with a warning in every response, so a typo never blocks the CLI. Disable a user plugin by removing it from `plugins.enabled`.

### Bundled core plugins

In bundle order, which is also their registration and activation order:

| Plugin | Contributes | Settings | Reference |
| --- | --- | --- | --- |
| `templates` | `templates` command and `make document`: shared Markdown templates in `bin/templates` and the planning workflow pack; provides `templates.installer`, the starter templates `setup` installs | `dateFormat`, `timeFormat` | [Templates](templates.md) |
| `scaffolds` | `make entity`, `value-object`, `use-case`, `event`, `form` and `plugin`; provides `scaffolds.projects`, the files `project create` and `project component` write | none | [CLI commands](cli.md#commands), [forms](forms.md) |
| `ui` | `components` and `interactions` commands and the `make ui` and `make stories` generators: Markdown component and interaction libraries rendered for html, htmx, vanilla, vue, svelte, react and angular, with Storybook stories. Its codes (`INVALID_UI`, `UNKNOWN_INTERACTION`, `UI_DRIFT`, …) stay in the kernel error catalog | `framework`, `components`, `componentImports`, `componentExports`, `interactions`, `interactionImports`, `interactionExports`, `output`, `stories` | [UI components](ui-components.md), [Interactions](interactions.md), [Storybook](storybook.md) |
| `data-sources` | `data-sources` command and the `make data-source` generator: Markdown REST and local-JSON definitions rendered to typed TypeScript adapters with deterministic test data. Its codes (`INVALID_DATA_SOURCE`, `UNKNOWN_DATA_SOURCE`, `DATA_SOURCE_DRIFT`, …) stay in the kernel error catalog | `library`, `imports`, `exports`, `output`, `fixtures` | [Data sources](data-sources.md) |
| `claude` | `claude` command for native Claude Code agents, hooks and plugin assets and the installed CLI lifecycle; the `claude.*` lifecycle events; provides `claude.lifecycle` | none | [Claude Code management](claude.md), [reuse Claude lifecycle execution](#reuse-claude-lifecycle-execution) |
| `bases` | `bases` command: native `.base` views as file repositories; provides the `bases.query` service | none | [Bases queries](bases.md) |
| `skills` | `skills` command and the bundled agent skills | none | [CLI commands](cli.md#commands) |
| `search` | `search` command; `INVALID_SEARCH_PATTERN` and `SEARCH_TIMEOUT` codes | `timeoutMs` | [Search](search.md) |
| `links` | `links` command: outgoing links, backlinks, unresolved links, orphans and dead ends | `roots` | [Links](links.md) |
| `agents` | `agents` command: docker-agent definitions and generated Claude Code agents; the `agents.generated` event, the `forge-agents` skill, and `INVALID_AGENT_DEFINITION`, `AGENT_NOT_FOUND`, `AGENT_EXISTS`, `AGENT_MERGE_CONFLICT` and `AGENT_DRIFT` codes | `directory`, `defaultModel` | [Agents](agents.md) |
| `connector` | `connectors` command; connection profiles; `connector.*` events; `CONNECTOR_*` and `CONNECTION_INVALID` codes; provides the `connector.hub` service | `connections` | [Connectors](connectors.md) |
| `connector-azure-devops` | The Azure DevOps Boards connector; provides `connector-azure-devops.connector` and registers it with the hub; requires `connector.hub` | none | [Azure DevOps connector](connector-azure-devops.md) |
| `backlog` | `backlog` command for backlog-view compatible product backlogs, including `backlog sync`; `backlog.*` events; the `forge-backlog` skill; `BACKLOG_*` and `SYNC_CONFLICT` codes; requires `bases.query`, optionally uses `connector.hub` | `base`, `view` | [Backlog](backlog.md) |

Two kernel commands use core plugin services and keep working without them. `setup` installs the starter templates from `templates.installer`; with `templates` disabled or unavailable it installs no templates, omits the template next steps and warns. `project create` and `project component` write the files of `scaffolds.projects`; with `scaffolds` disabled or unavailable they fail with `PLUGIN_UNAVAILABLE` (`details`: `command`, `plugin`, `service`, `reason`, `issues`), while `project list`, `open`, `current`, `close` and `inspect` keep working.

Each declares German strings for its command, actions, events and codes. Disabling one, for example `{"plugins": {"disabled": ["bases"]}}`, removes exactly its contributions; the kernel commands (`list`, `read`, `move`, …) stay, and a command of a plugin listed in `plugins.disabled` is unknown (`UNKNOWN_COMMAND`), since its code never ran. A plugin that requires a service of a disabled plugin stays registered but becomes unavailable: disabling `bases` leaves `backlog` without `bases.query`, so `plugins` lists `backlog` as `unavailable` with `reason` "Requires service bases.query; its provider bases is disabled.", `help backlog` still describes it, and `backlog list` fails with `PLUGIN_UNAVAILABLE`. An optional service never makes its user unavailable: disabling `connector` makes `connector-azure-devops`, which requires `connector.hub`, unavailable, while `backlog` stays enabled and only `backlog sync` fails with `PLUGIN_SERVICE_MISSING`. Service ids start with their provider's plugin id and a dot, core plugins included, so the host names the disabled provider without running it.

`node bin/forge.js plugins` lists every plugin, core plugins first: the manifest fields, `core`, `state`, `reason` and `contributions`. `state` is one of:

| State | Meaning | `reason` |
| --- | --- | --- |
| `enabled` | Registered and runnable | `null` |
| `unavailable` | Registered, but its config section is invalid or a service it requires has a disabled or unavailable provider; it never activates and its commands and generators fail with `PLUGIN_UNAVAILABLE` | "plugins.settings.&lt;id&gt; is invalid: …", "Requires service &lt;service&gt;; its provider &lt;id&gt; is disabled." or "… is unavailable." |
| `disabled` | A core plugin in `plugins.disabled`, or an installed user plugin that `plugins.enabled` does not name | "Listed in plugins.disabled." or "Not listed in plugins.enabled." |
| `skipped` | An enabled user plugin that `--no-plugins` left unloaded | "Skipped by --no-plugins." |
| `rejected` | An installed user plugin whose id a bundled core plugin owns, enabled or disabled; it never loads and is listed besides the core entry | "Plugin id &lt;id&gt; is reserved by the bundled core plugin; rename the user plugin." |

`contributions` lists command, generator, event and skill ids, `services.provides`, `services.requires` and `services.optional`, the `settings` config path or `null`, the languages of contributed `strings` and registered error codes; it is `null` for plugins whose code did not run (`disabled`, `skipped`, `rejected`). Invalid manifests in `bin/plugins` are skipped with a warning.

## Contract

The shipped type-only SDK is `bin/data/types/sdk.d.ts`. A user plugin module exports an object or a class instantiated with its manifest; the loader supplies the manifest to the resulting instance. A TypeScript module can declare contributions as follows:

```ts
import type { Plugin } from '../bin/data/types/sdk.js';
const plugin = {
  commands: [{
    id: 'quality.status',
    description: 'Report readiness',
    usage: 'quality.status [--verbose]',
    scope: 'project',
    mutating: false,
    options: { verbose: { type: 'boolean', description: 'Include every check.' } },
    errors: ['QUALITY_NOT_READY'],
    run(_args, flags, context) { return { ready: true, verbose: flags.verbose === true, threshold: context.settings?.threshold }; },
  }],
  settings: { type: 'object', additionalProperties: false, properties: { threshold: { type: 'integer', minimum: 1, default: 3 } } },
  errors: [{ code: 'QUALITY_NOT_READY', category: 'drift', summary: 'The workspace is not ready.', hint: 'Run quality.status --verbose and fix the failing checks.' }],
  strings: { de: { commands: { 'quality.status': 'Bereitschaft melden' } } },
} satisfies Omit<Plugin, 'manifest'>;
export default plugin;
```

Invalid contributions or duplicate IDs reject the complete plugin registration, leaving no partially registered capabilities. All contributions register before lifecycle activation.

- **Commands:** `id`, `description`, `usage`, `run(args, flags, context)` and the [command metadata](#command-metadata). Return JSON-serializable data; never log to stdout. Send diagnostic messages to `context.events.warn`.
- **Generators:** see [generators](#generators).
- **Skills:** `id`, `content` containing a Markdown SKILL.md with frontmatter. They appear in `skills list/show/install` and `setup`.
- **Events:** `id`, optional nonempty `description`, and `validate(payload)` synchronous runtime type guard returning a boolean. Segments start with a lowercase letter and may use camelCase or kebab-case. `context.events.on<T>(id, callback)` supports typed callbacks; callers remain responsible for the name/type pairing, and emit validates data at runtime. Descriptions appear in event discovery. A plugin may emit only events in its own `<plugin-id>.*` namespace; see [event ownership](#event-ownership).
- **Services:** `provides: {serviceId: implementation}`, `requires: [serviceId]` and `optional: [serviceId]`; see [services](#services).
- **Settings:** `settings`, a JSON Schema of the plugin's config section, and optional `validateSettings`; see [config sections](#config-sections).
- **Strings and error codes:** `strings: {en?, de?}` and `errors: [...]`; see [strings and error codes](#strings-and-error-codes).
- **Lifecycle:** optional `onload(context)` runs in activation order; `onunload()` runs in reverse order after success or failure, including partial loading. Optional `onUserEnable(context)` and `onExternalSettingsChange(context)` run right after `onload`; see [lifecycle hooks](#lifecycle-hooks-layout-ready-and-quit). The existing cleanup hook is captured before `onload` and retains its plugin receiver, so release partially acquired resources safely. Replacing `onunload` during activation does not replace the captured cleanup. Cleanup errors become warnings. Returning a function from `onload` is not a cleanup contract; implement `onunload` explicitly.

`context` supplies `workspaceRoot`, `root`, `project`, `workspace`, `environment`, `events`, `metadata`, `app`, `language` and a lazy `input()` reader; a plugin's hooks, commands and generators additionally receive `settings`, `services` and `t(key)`. `app` is the Obsidian-shaped [facade](#the-app-facade) over the same scope; prefer it. `metadata` is the invocation's lazily built [metadata index](../explanation/architecture.md#kernel-metadata-cache) for the same root as `workspace`, which `app.metadataCache` wraps. A plugin's `onload`, activation hooks and commands receive `events` as that plugin's `EventChannel` (exported by the SDK): it observes every event and exposes `ids`, `catalog`, `on`, `once`, `onAny`, `replay`, `emit`, `warn`, `onLayoutReady` and `onQuit`. `workspaceRoot` always identifies the environment; `project` is the active project metadata or null. `root` and `workspace` are the command's scope: the active project for a project-scoped command (the workspace when none is selected), and the workspace for a workspace-scoped command. `environment` is always the workspace-root scope, so a plugin reaches workspace files explicitly, never through the selection. `language` is the response language (`en` or `de`). `workspace.read`, `workspace.edit`, `workspace.write`, `workspace.remove` and `workspace.commit` (a batch of renames, writes and removals) apply their validation, revision, dry-run and event contracts. In a dry run, `workspace.edit` returns each change with a unified `diff`; pass `workspace.write(writes, { diff: true })` for the same preview on writes (`diff: null` for binary content). The SDK types these as `WriteOptions` and `PlannedChange` (a `FileChange` with `diff`). `workspace.read` and `workspace.codec.inspect` return the complete Markdown document including `body`; only the CLI `read` response omits it unless `--parts body` is given. `workspace.files` is the repository port, with `read`, `list`, `stat` (a file's revision and size, or a folder's revision, files and folders) and the guarded `commit` batch of renames, writes and removals; its direct reads and listings produce neither `operation.*` phases nor `workspace.file-open`. Use workspace methods for writes so validation and notifications remain consistent. `workspace.dryRun` describes the invocation.

Discovery commands (`help`, `schema`, `config`, `formats`, `events`, `plugins`, `setup` and `claude capabilities`) and `--help` register contributions without calling `onload`. Their module imports still execute top-level code, so entry points must avoid top-level side effects. Other commands run the lifecycle; respect dry-run and avoid unrelated writes. `--no-plugins` skips loading user plugins entirely.

The [quality example](../examples/plugins/quality/main.mjs) includes commands, a generator, event listeners, a skill, a config section, German strings and an error code, and uses the [app facade](#the-app-facade): `app.vault.on('rename')` warns about moved notes in the response language, `quality.mark-reviewed <note.md>` edits frontmatter with `app.fileManager.processFrontMatter`, and `quality.owners` reads `app.metadataCache.getFileCache` and fails with `QUALITY_UNOWNED` for notes without the configured owner property. Copy its `quality` directory to workspace `bin/plugins/quality`, review it, and enable `quality` in `bin/config.json`. Then run `node bin/forge.js quality.check`. The distribution also includes the example under `bin/data/docs/examples/plugins/quality`.

## Command metadata

One declaration drives argument parsing, the invocation policy, `help` and `schema`. Every built-in command declares it, and the policy that chooses scope and plugin activation reads nothing else.

| Field | Meaning | Default for plugin commands |
| --- | --- | --- |
| `scope` | `project`: the selected project's root, or the workspace when none is selected. `workspace`: always the workspace root | `project` |
| `discovery` | A discovery or recovery command: workspace scope, no plugin activation, so a stale selection or a failing `onload` cannot block it | `false` |
| `mutating` | Whether the command (or an action) can change files or external state | `true` |
| `options` | `{flag: {type: 'string' \| 'boolean', description, enum?, default?, required?}}`. Global options are reserved. The parser enforces types; the command validates values, `enum`, `default` and `required` are published for agents | `{}` |
| `args` | Positional arguments after the command id: `[{name, description, required?, enum?, variadic?}]`; only the last may be variadic | `[]` |
| `actions`, `defaultAction` | Refinements keyed by the first argument, such as `skills install`, each `{description, usage?, scope?, discovery?, mutating?, projectOption?, options?}`; `defaultAction` applies when the first argument is omitted. An action's `options` are accepted only with that action and cannot repeat a command option | none |
| `unknownAction` | A built-in error code reported when the first argument names no declared action, ahead of option errors, so options after an unknown action never read as `UNKNOWN_OPTION` (`make` declares `UNKNOWN_GENERATOR`) | none |
| `projectOption` | A declared string option that selects the project for this invocation (`make ui --project web`) | none |
| `output` | Optional JSON Schema of `data` in a successful response | none |
| `errors` | Codes the command reports itself (built-in or the plugin's registered codes) | `[]` |

Invalid metadata fails registration with `INVALID_PLUGIN`. `help` returns the catalog; `help <command>` (or `<command> --help`) returns `{id, description, usage, options, args, annotations, errors, outputSchema?, globalOptions}`. `schema` returns the same entry for every command plus `inputSchema`, a JSON Schema 2020-12 document of one invocation. For a command without actions it describes `args` and `options` directly:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "skills", "type": "object", "additionalProperties": false, "required": ["args", "options"],
  "properties": {
    "args": { "type": "array", "items": { "type": "string" }, "prefixItems": [{ "type": "string", "enum": ["list", "show", "install"] }, { "type": "string" }], "minItems": 0, "maxItems": 2 },
    "options": { "type": "object", "additionalProperties": false, "properties": { "out": { "type": "string", "default": ".agents/skills" } } }
  }
}
```

A command with actions publishes `{"$schema", "title", "type": "object", "required": ["args", "options"], "oneOf": [...]}` with one branch per action: the branch pins the first argument with `const` (`"prefixItems": [{"type": "string", "const": "install"}, …]`) and lists the command's options plus that action's own, with only that action's `required` options. When the first argument is optional, a first branch without arguments covers the default action (or, for `make`, the generator listing). `make document` therefore requires `--template`, while `make entity` accepts only `--out`.

`annotations` holds the default mode's `scope` and `discovery`, `mutating` and `readOnlyHint` for the whole command, the `defaultAction`, and each action's resolved mode with its `usage` and `options` when it declares them. `mutating` is `true` when any mode of the command mutates, so `readOnlyHint` is `true` only for commands whose every action is read-only; each action's `mutating` and `readOnlyHint` describe that action alone (`skills list` is read-only, `skills install` is not). Global options are described once in `globalOptions` with the same option shape. The schema subset Forge emits and accepts covers `type`, `properties`, `required`, `additionalProperties`, `items`, `prefixItems`, `minItems`, `maxItems`, `enum`, `const`, `oneOf`, `default`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `title` and `description`; other keywords are rejected rather than ignored. A `oneOf` value must match exactly one branch, whose defaults complete it.

## Generators

`make <generator> <Name>` routes to every registered generator by id: core plugin generators (`document` from `templates`; `entity`, `form`, `plugin`, … from `scaffolds`; `ui` and `stories` from `ui`; `data-source` from `data-sources`) and user plugin generators alike. A generator declares `id`, `description`, optional `usage`, the mode fields `scope` (default `project`), `mutating` and `projectOption`, `options` with the command option shape, an optional default output `directory` (default `src/domain`) and `fixedDirectory` to reject `--out`, and exactly one of:

- `generate(request)`: returns the write plan `{path, bytes, expectedRevision?}[]`. The host validates documents and destinations and previews (`--dry-run`) or writes the plan, emitting committed `vault.*` events. With `review: true`, the host also accepts `--plan`, `--plan-out`, `--check` and `--revisions-from` and runs the plan through the shared generation service: `--plan` reports each output's status, `--check` fails with `GENERATION_DRIFT` when outputs differ, and `--revisions-from` authorizes regeneration of reviewed files.
- `run(request)`: returns its own result, for generators that need full control.

`request` is `{name, directory, flags, context, generation}`: the name argument, the resolved output directory (`--out`, else `directory`), the invocation's flags, the plugin context and the `GenerationService` with `plan(writes, manifestPath?)`, `check(writes, code)` and `commit(writes, revisions?)`. Generators should be pure and never write directly. Encode text with `new TextEncoder().encode(text)`.

Each generator is an action of `make` with its own options. `make` owns `--out` (unless `fixedDirectory`) and the review options `--plan`, `--plan-out`, `--check` and `--revisions-from`: a plugin generator that declares one of them fails registration with `PLUGIN_NAMESPACE`. Only a reviewed generator may list the host's own review option definitions, to place them among its options; the bundled library generators (`ui`, `stories`, `data-source`) list them after `--project` and `--library`. The parser resolves the generator first and then accepts only the global options, `--out`, the generator's options and, with `review`, the review options; anything else is `UNKNOWN_OPTION`. An id that names no registered generator, for example one from a disabled plugin, fails with `UNKNOWN_GENERATOR` before its options are considered. Put generator options after `make <generator>`: an option before the generator id is parsed without the generator and is unknown. Because each generator's options are parsed on their own, two generators may declare the same option name with different types. `make` without arguments lists the generators, and `help make` lists each generator's mode, usage and options under `annotations.actions`.

## Services

A plugin offers named services with `provides: {serviceId: implementation}`, declares what it needs with `requires: [serviceId]` and what it uses when available with `optional: [serviceId]`. Services replace imports between plugins: a core plugin never imports another plugin's code, and a user plugin cannot.

- Activation follows the dependency order: every plugin activates after the providers of the services it requires or optionally uses (when enabled); unrelated plugins keep their order. A required service without an enabled provider fails activation with `PLUGIN_SERVICE_MISSING` (`details: {plugin, service}`), and a dependency cycle with `PLUGIN_SERVICE_CYCLE` (`details.plugins` names the cycle), before any `onload` runs.
- `context.services.get<T>(id)` returns a read-only view of a provider's implementation: assigning, defining or deleting a member, or changing its prototype, throws a `TypeError`, while its methods still run against the provider's own object, so the provider keeps its state. The view is shallow; protect objects that methods return yourself. A plugin may get only services it declared in `requires` or `optional` or provides itself; an undeclared lookup, or an optional service without an available provider, is `PLUGIN_SERVICE_MISSING`. `context.services.has(id)` tells whether a declared service has an available provider.
- A plugin whose required service has a disabled or unavailable provider becomes unavailable (see [bundled core plugins](#bundled-core-plugins)); an optional service whose provider is disabled or unavailable leaves it available, and `services.has` reports the service as absent.
- Service ids start with the provider's `<id>.`, for core plugins too, so the host knows which disabled plugin a missing service belongs to. A second provider of one id fails registration with `DUPLICATE_OR_INVALID_ID`.

## Config sections

A plugin declares its settings as a JSON Schema of type `object` in `settings`. Users configure them in `bin/config.json` under `plugins.settings.<id>`, for core and user plugins alike:

```json
{ "plugins": { "enabled": ["quality"], "settings": { "quality": { "ownerProperty": "maintainer" } } } }
```

After plugins register, the host validates each declared section, fills `default`s, runs the plugin's optional `validateSettings(settings)` for checks JSON Schema cannot express (it returns `<path>: <problem>` issues and performs no I/O; the `links` plugin uses it to compile its root globs) and hands the result to the plugin as `context.settings` (`null` without a schema), a frozen deep copy that plugin code cannot change. Every `default` in the schema must satisfy its own schema; otherwise registration fails with `INVALID_PLUGIN`. An invalid section never blocks the CLI: the plugin becomes unavailable for the invocation (`state: "unavailable"` with a `reason` in `plugins`), together with every plugin that requires one of its services, and every response carries a warning naming each path, such as `plugins.settings.quality.ownerProperty: must have at least 1 characters`. Unavailable plugins never activate; their commands and generators fail with `PLUGIN_UNAVAILABLE`, with `error.details` `{command or generator, plugin, reason, issues}`. Discovery and recovery commands (`config`, `help`, `schema`, `plugins`) and the other plugins keep working. A section for a loaded plugin that declares no settings is ignored with a warning, and a section whose id names no registered, disabled or installed plugin (a misspelled id such as `serach`) is kept unchanged with a warning; sections of disabled or uninstalled plugins are kept unchanged. `config` shows the effective sections in `data.config.plugins.settings` and their schemas in `data.sections` (`[{plugin, path, schema}]`). Changing a section triggers [`onExternalSettingsChange`](#lifecycle-hooks-layout-ready-and-quit) once.

## Strings and error codes

`strings` contributes localized text per language, `en` and `de`: `commands`, `generators` and `events` map the plugin's own ids to descriptions; `actions` maps `<command> <action>` keys of the plugin's own command actions (`"links orphans"`) to descriptions; `errors` maps its registered codes to `{summary, hint}`; `messages` holds free-form guidance that plugin code reads with `context.t(key)` in the response language, falling back to English and then to the key. Keys must name the plugin's own contributions (`PLUGIN_NAMESPACE` otherwise). The localizer merges them after the kernel catalogs, so `--lang de` describes plugin commands, their actions, generators and events in German.

`errors` registers catalog entries `{code, category, summary, hint, retryable?}`, with the categories and exit statuses of the [error catalog](errors.md). Plugin code cannot construct host errors, so it throws an `Error` with a registered `code` and optional `details`:

```js
throw Object.assign(new Error('2 notes have no owner.'), { code: 'QUALITY_UNOWNED', details: { notes } });
```

The host turns it into a failure with the category's exit status, the catalog `hint` and `retryable`, and with `--lang de` the German summary and hint, keeping the original message in `details.localization.originalMessage`. `schema` lists registered codes after the built-in ones with their `plugin`. Unregistered codes keep the plain `{code, message, details?}` shape.

A core plugin may also throw built-in catalog codes. The `bases`, `templates`, `scaffolds`, `ui`, `data-sources` and `claude` plugins keep their feature codes (`BASE_*`, `INVALID_TEMPLATE_VALUES`, `INVALID_UI`, `UNKNOWN_INTERACTION`, `UNKNOWN_DATA_SOURCE`, `INVALID_CLAUDE_AGENT`, …) in the kernel catalog, so `schema` lists them among the built-in codes whether or not the plugin is enabled, and their German summaries stay in the kernel's German error catalog; plugins added as plugins (`search`, `agents`, `connector`, `backlog`) register their own.

Codes are owned. The host maps a thrown code only when the plugin whose command, generator or activation hook threw it registered that code, or when it is a built-in catalog code such as `NOT_FOUND` (which then carries its built-in exit status and hint). A code registered by a plugin that provides a service the thrower declares in `requires` or `optional` maps too, because the provider's failures surface through its consumer's calls (`backlog sync` reports the `connector` plugin's `CONNECTOR_AUTH_FAILED`). Any other plugin's registered code stays an uncoded failure (`OPERATION_FAILED`, original message kept): a plugin cannot borrow a code it does not own. Each user plugin code belongs to the registered user plugin with the longest matching prefix: while plugin `a-b` (`A_B_`) is registered, plugin `a` (`A_`) cannot register `A_B_X`, and `a-b` cannot register after `a` registered `A_B_X`. The plugin that registers later fails with `PLUGIN_NAMESPACE`, so the outcome follows the configured load order.

## Source layout and layering

A core plugin is a self-contained slice of the Forge source with the same layers as the kernel:

```text
src/plugins/<id>/
  plugin.ts                 # the CorePlugin: manifest (core: true) and create(host) wiring its own layers
  domain/…                  # pure rules and values
  application/…             # use cases and ports
  infrastructure/…          # adapters, codecs, bundled assets
  presentation/…            # command definitions and input translation
```

| From | May import |
| --- | --- |
| `src/plugins/<id>/domain/` | Its own `domain/`, kernel `src/domain/` |
| `src/plugins/<id>/application/` | Its own `domain/` and `application/`, kernel `src/domain/` and `src/application/` |
| `src/plugins/<id>/infrastructure/` | Its own `domain/`, `application/` and `infrastructure/`, kernel domain and application, external packages and assets |
| `src/plugins/<id>/presentation/` | Its own `domain/`, `application/` and `presentation/`, kernel domain and application |
| `src/plugins/<id>/plugin.ts` | Its own four layers, kernel domain and application |
| Kernel layers | Never `src/plugins/` |
| `src/main.ts` | Each plugin's `plugin.ts` only |

The internal plugin SDK is the kernel's application layer, chiefly `src/application/plugins/`: the contracts (`Command`, `Generator`, `PluginContributions`, `CorePlugin`, `CorePluginHost`), command metadata helpers (`option`), command input helpers (`arity`, `value`, `globalOptions`, `parseJson`, `readInputBytes` in `command-input.ts`), the definition library command helpers (`library-commands.ts`: `libraryMetadata`, `libraryOptions`, `localizedLibraryResult`), path settings checks (`relativePathIssues`, `relativePathSetting` in `plugin-settings.ts`) and the generation controls next to `GenerationService` (`src/application/generation/controls.ts`: `reviewOptions`, `generationControls`, `libraryGenerationOptions`, `generationOutputPath`). Plugins never import kernel infrastructure or presentation, or another plugin; they use declared services instead. `src/main.ts` lists the bundled plugins and calls `registerCorePlugins` with a `CorePluginHost` of kernel ports (`skills`, the live skill catalog; `fileDates`, which reads file sizes and filesystem dates below a command root for Bases; `openFiles`, which opens the guarded repository at a directory outside the workspace for Claude's user scope; `operationId`, the invocation-wide operation counter that `claude.*` records share with `command.*` and `operation.*`; `http`, the `HttpClient` port over `fetch` with timeouts and 429/503 retries of repeatable requests for connectors; `locks`, exclusive lock files below a command root with holder metadata (the backlog sync lock); and `environment`, which reads one environment variable such as a connector's token variable); `create(host)` wires the plugin's adapters to those ports without I/O. When a plugin needs another kernel capability, add a port to `CorePluginHost` and supply its adapter in `src/main.ts`. Architecture tests and `npm run check:structure` enforce the layout and these rules. Tests for a core plugin live in `tests/<id>/`.

## Reuse Claude lifecycle execution

The bundled `claude` core plugin provides the service `claude.lifecycle`, the same lifecycle client its `claude` command uses to invoke the installed Claude CLI. A plugin declares it in `requires` and calls `context.services.get('claude.lifecycle').execute(request)`; it needs no imports from Forge internals or a new contribution type. With `claude` disabled (`plugins.disabled`), a plugin that requires the service is unavailable and its commands fail with `PLUGIN_UNAVAILABLE`:

```ts
import type { Plugin } from '../bin/data/types/sdk.js';
export default {
  requires: ['claude.lifecycle'],
  commands: [{
    id: 'quality.claude-plugins',
    description: 'Inspect installed Claude plugins',
    usage: 'quality.claude-plugins',
    run(_args, _flags, context) {
      return context.services.get<{ execute(request: object): Promise<unknown> }>('claude.lifecycle').execute({
        args: ['plugin', 'list', '--json'],
        output: 'json',
      });
    },
  }],
} satisfies Omit<Plugin, 'manifest'>;
```

Like every plugin service, the client is not part of the SDK's kernel types; its shape is `{ execute(request): Promise<result> }`. Requests contain literal `args` and optional `executable`, `timeoutMs`, UTF-8 `stdin`, `output` and `sensitiveArgs` indices. `output` is `text` by default, `json` for an entire JSON response, or `json-last-line` for commands whose final stdout line is native JSON. The `claude` plugin binds the client when it activates: the working directory is the invocation's selected root and its dry-run setting applies. A plugin cannot override either through this service, and the client fails with `PLUGIN_LIFECYCLE` outside an activated command invocation.

Dry runs validate the request and return `{dryRun:true, executed:false, plan}` without creating a runtime process. Real execution passes arguments directly without a shell, closes stdin after optional input, and applies timeout/output bounds. `stdin` contents are omitted from plans; plans record `inputBytes`. `--config` values and indices listed in `sensitiveArgs` are redacted in the plan. Native stdout/stderr remain available for diagnostics and may contain values echoed by Claude itself.

Successful execution returns the plan fields plus `dryRun:false`, `executed:true`, `exitCode`, `stdout`, `stderr`, and parsed `result` when requested. A nonzero native exit remains `CLAUDE_RUNTIME_FAILED`; its error details preserve exit status, diagnostic streams and parseable native JSON. Inspect that result before retrying an operation that may already have changed external state. Invalid requested JSON after a successful exit yields `CLAUDE_INVALID_OUTPUT`. An already-achieved state reported by Claude is not silently reclassified as success.

The `claude` plugin emits `claude.started` before service validation, followed by `claude.succeeded` or `claude.failed` for validation, previews, process execution and output parsing. The existing `claude.executed` event remains: it follows a process exit status, including nonzero status, with `{executable,cwd,exitCode}`. Dry runs and process failures without an exit status emit no `claude.executed`. A successful process can still produce `claude.failed` when requested JSON is malformed. These events omit arguments, stdin and native output; inspect the command result for detailed diagnostics. Listener failures remain warnings and cannot erase the native result. This service runs already-authorized operations chosen by a trusted plugin; it does not install Claude, trust a plugin automatically, or change the existing explicit Forge plugin-enablement rules.

## Host events and correlation

Run `node bin/forge.js events --json` to discover event IDs in `data.events`, descriptions in `data.contracts`, and delivery semantics in `data.delivery`. `context.events.catalog()` exposes `{id, description?}` entries. The type-only SDK exports `HostEventMap`, `HostEventId` and the discriminated `HostEventRecord` union in addition to the open `EventRecord` used for plugin-defined events.

| Event family | Observation boundary and payload |
| --- | --- |
| `command.started`, `command.succeeded`, `command.failed` | Routed command lifecycle, including plugin activation and command-result serialization; `operationId`, command ID, `root`, `workspaceRoot`, `dryRun` |
| `operation.started`, `operation.succeeded`, `operation.failed` | Guarded workspace `read`, `write`, `edit`, `remove`, `move` or `delete`; `operationId`, `operation`, `root`, relative `paths`, `dryRun`; success can include bytes, change summaries and `renames` (`{from, to, kind}`) |
| `vault.create`, `vault.modify`, `vault.delete` | Obsidian's vault events after a committed write: `{path, kind, operation, revision?, bytes?}`. Files (`kind: "file"`) carry SHA-256 `revision` and `bytes` (prior content for a delete); folders (`kind: "folder"`) carry neither. `vault.modify` is file-only |
| `vault.rename` | `{path, oldPath, kind, revision?}` after a committed move: `path` is the new path. A moved folder publishes one record for itself, then one per moved descendant folder and file in path order; files carry their unchanged `revision`. `vault.rename` never updates links itself; the `move` batch publishes `vault.modify` for each rewritten file after the renames |
| `metadataCache.changed`, `metadataCache.deleted`, `metadataCache.resolve`, `metadataCache.resolved` | Obsidian's MetadataCache events, emitted after a committed batch's `vault.*` records once `context.metadata` was loaded in the invocation: `{path, cache}` per re-indexed Markdown or Canvas file with metadata, `{path, prevCache}` per file that left the index (`prevCache` is `null` for files without metadata), `{path}` per source whose link resolution was recomputed, then one `{}` per batch. `cache` is the JSON form of Obsidian's `CachedMetadata` shape. Paths are relative to `context.root`; see [metadata events](#metadata-events) |
| `workspace.file-open` | `{path}` after each successful `workspace.read`: the `read` command and plugin calls to `context.workspace.read` |
| `workspace.quick-preview` | `{path, operation, bytes}` for each planned file of a dry-run write, edit or removal; no content or diff |
| `workspace.layout-ready` | `{}` after every plugin activated and queued `onLayoutReady` callbacks ran, before the command runs |
| `workspace.quit` | `{}` at invocation end, after the command result, before quit tasks and plugin unloading; also after failures |
| `workspace.project-change` | `{from, to}` project names (or `null`) after `project open` or `project close` committed a different selection |
| `plugin.registered` | Atomic contribution registration was published; `pluginId` |
| `plugin.activating`, `plugin.activated`, `plugin.activation-failed` | Activation hook boundaries; `pluginId` |
| `plugin.unloading`, `plugin.unloaded`, `plugin.unload-failed` | Cleanup boundaries in reverse activation order; `pluginId` |

The `claude` core plugin owns the `claude.*` records of its lifecycle service:

| Event family | Observation boundary and payload |
| --- | --- |
| `claude.started`, `claude.succeeded`, `claude.failed` | Claude lifecycle service invocation; `operationId` (shared with `command.*` and `operation.*`), executable, `cwd`, `dryRun`; terminal events include native `exitCode` when received |
| `claude.executed` | Native process returned an exit status; executable, `cwd`, native `exitCode` |

Failed phase payloads add `error: {code, exitCode}`. These summaries omit raw error messages and inputs; they do not replace the original error in the command response. Claude's optional top-level `exitCode` is its native process status, while `error.exitCode` is the host error status. Host metadata still contains paths, roots, command/plugin IDs and executable names; it is not a content-free audit record.

Each command, operation and Claude invocation obtains a positive integer from `events.nextOperationId()`. Its started and terminal records share that ID. IDs are invocation-local correlation values, not persistent identifiers or parent-child links. An edit calls a guarded write, so it produces distinct edit and write IDs; a failed write can be followed by a failed enclosing edit. Use operation IDs together with scope metadata instead of assuming one phase pair per CLI command. A workspace constructed without root provenance reports `root: null`.

`command.started` is recorded before plugin activation. Plugin listeners installed in `onload` can explicitly replay that record and earlier registration events. The host publishes registrations after loading contributions and before routing; registry activation also publishes any registrations not previously published. Discovery commands register plugins but do not activate their listeners, so they also emit no `workspace.layout-ready`. Bootstrap, module-loading and other failures before command routing cannot notify listeners that have not been installed.

The CLI response carries only committed `vault.*` records by default; run a command with `--events all` (or set `settings.events`) to see the full history in the envelope. Plugin listeners and `replay` always receive every event regardless of that level. The command envelope covers the routed CLI operation. Operation phases cover workspace methods, not every filesystem call: direct repository access, arbitrary plugin Node code and native subprocess activity are outside those method boundaries. Dry runs produce phase notifications, planned change summaries and `workspace.quick-preview` records but no `vault.*` or `metadataCache.*` events. `metadataCache.*` records are not change records: they appear in the envelope only with `--events all`.

### Metadata events

Like Obsidian's MetadataCache, the kernel index publishes its events after the vault events of the same commit. For each committed batch, in order: the batch's `vault.*` records; `metadataCache.changed` for each re-indexed Markdown or Canvas file that parsed (an unparseable file has no cache and no record); `metadataCache.deleted` for each file that left the index; `metadataCache.resolve` for each source whose `resolvedLinks`/`unresolvedLinks` entry was recomputed with a different result or new references; then one `metadataCache.resolved`. Each group is in vault path order. A write never builds the index, so metadataCache events are emitted for commits once the cache is loaded in the invocation; commands that need link integrity (delete and move, links, Bases) load it, and a plugin loads it with `await context.metadata.load()`. Without loading, `context.metadata.vaultFiles()` lists the scope's vault paths and `context.metadata.parseFile(path, bytes)` parses one file's metadata from bytes the plugin already read, as `search` does. Before that load, commits publish no metadataCache records, and the first load reads the current files. The index and its paths belong to the command root: when a project is selected, workspace-scope commits inside the project directory are re-indexed with project-relative paths and commits outside it are not indexed. Claude user-scope writes never reach the index.

## The app facade

`context.app` mirrors Obsidian's `App` for the command's scope, so logic written against Obsidian's API ports with few changes. Paths replace `TFile` objects. Every mutation is a guarded workspace write: it honours the invocation's dry run, accepts an optional `{ifMatch}` revision guard (without it, the revision read just before the write guards it), and publishes the same `vault.*` and `metadataCache.*` records as the CLI. The SDK exports the facade types `App`, `VaultFacade`, `MetadataCacheFacade`, `WorkspaceFacade`, `FileManager`, `MoveOptions`, `DeleteOptions`, `Guard` and `BrokenLink`.

| Member | Behaviour |
| --- | --- |
| `app.vault.read(path)` | UTF-8 text of a file; no `workspace.file-open` record |
| `app.vault.create(path, data)` / `modify(path, data, {ifMatch?})` | Create a new file (an existing one is a `CONFLICT`) or replace one; return the `FileChange` |
| `app.vault.process(path, fn, {ifMatch?})` | Atomic read-modify-write of UTF-8 text; `fn(text)` returns the new text, which `process` returns |
| `app.vault.append(path, data, {ifMatch?})` | Append UTF-8 text |
| `app.vault.rename(path, newPath, {ifMatch?})` | Move without link updates, like Obsidian's `Vault.rename` |
| `app.vault.trash(path, {ifMatch?})` / `delete(path, {ifMatch?})` | Move to `.trash` or remove permanently (folders recursively) without checking links, like Obsidian's `Vault.trash`/`delete` |
| `app.vault.getMarkdownFiles()` / `getFiles()` | Vault paths in path order, as indexed by the metadata cache: dot-prefixed files and folders and, at the workspace root, the workspace's `bin/` distribution are omitted (see the [vault rule](formats.md#metadata-index)) |
| `app.vault.on('create' \| 'modify' \| 'delete' \| 'rename', callback)` | Subscribes to `vault.*`; the callback receives the record payload with `path` (and `oldPath` for renames). Returns an unsubscribe function |
| `app.metadataCache.getFileCache(path)` | A copy of the file's `CachedMetadata`, or `null` |
| `app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)` / `fileToLinktext(path, sourcePath, omitMdExtension?)` | Link resolution and shortest link text |
| `app.metadataCache.resolvedLinks()` / `unresolvedLinks()` | Copies of the link maps |
| `app.metadataCache.on('changed' \| 'deleted' \| 'resolve' \| 'resolved', callback)` | Subscribes to `metadataCache.*` |
| `app.fileManager.renameFile(path, newPath, {ifMatch?})` | Move with link updates, exactly like the `move` command; returns its result |
| `app.fileManager.trashFile(path, {ifMatch?, allowBrokenLinks?})` | Move a file or folder to `.trash`; refuses with `HAS_BACKLINKS` while other files link into it, like the `delete` command |
| `app.fileManager.processFrontMatter(path, fn, {ifMatch?})` | `fn` mutates a copy of the properties; changed keys are set and deleted keys removed in one guarded edit that preserves the body |
| `app.fileManager.move` / `rename` / `delete` | The full `move`, `rename` and `delete` command operations with their options |
| `app.workspace.onLayoutReady(callback)` | Same as `context.events.onLayoutReady` |
| `app.workspace.on('file-open' \| 'quick-preview' \| 'quit' \| 'project-change', callback)` | Subscribes to `workspace.*` |
| `app.workspace.getActiveProject()` | The project the command runs in, or `null` at workspace scope |

Differences from Obsidian: the metadata cache is built lazily per invocation, so `metadataCache` accessors return promises and the link maps are methods; `vault` listing methods are asynchronous for the same reason. Subscriptions last for the invocation. Calls the facade makes inside a listener are ordinary guarded writes and publish their own records.

```ts
import type { Plugin } from '../bin/data/types/sdk.js';
export default {
  onload({ app, events }) {
    app.vault.on('rename', ({ path, oldPath }) => events.warn(`Moved ${oldPath} to ${path}`));
  },
  commands: [{
    id: 'quality.mark-reviewed',
    description: 'Mark a note as reviewed',
    usage: 'quality.mark-reviewed <note.md>',
    async run([path], _flags, { app }) {
      return app.fileManager.processFrontMatter(path!, frontmatter => { frontmatter.reviewed = true; });
    },
  }],
} satisfies Omit<Plugin, 'manifest'>;
```

## Event ownership

Host namespaces (`vault`, `metadataCache`, `workspace`, `operation`, `command`, `plugin`) are host-owned; `events --json` lists them in `data.hostNamespaces`. A plugin's channel may observe any event, but `context.events.emit(id, payload)` accepts only ids starting with `<plugin-id>.`. Emitting a host event or another plugin's event rejects with `EVENT_OWNERSHIP` before validation, delivery or history; an unknown id in the plugin's own namespace remains `UNKNOWN_EVENT`. Plugin ids cannot be host namespaces. Core plugins follow the same rule, so a core plugin owns its id's namespace (`bases.*`, `backlog.*`, `claude.*`) exactly like a user plugin. Host-built commands receive the invocation bus itself. Plugins are trusted code, not a sandbox: ownership protects the event contract, not the process.

## Lifecycle hooks, layout ready and quit

Activation runs, per plugin in [service dependency order](#services) (otherwise core plugins in bundle order, then user plugins in configured order): `plugin.activating`, `onload(context)`, then at most one activation hook, then `plugin.activated`.

- `onUserEnable(context)` runs once, on the first activation after the plugin was enabled (added to `plugins.enabled`, or a core plugin removed from `plugins.disabled`). Use it for one-time setup.
- `onExternalSettingsChange(context)` runs on a later activation when the plugin's settings revision differs from the one recorded at its previous activation. The revision is the SHA-256 of the plugin's effective [config section](#config-sections) in canonical JSON, or `null` for a plugin without one, so editing `plugins.settings.<id>` in `bin/config.json` triggers it once. `context.settings` already holds the new values.

Both hooks must return nothing; a throw is an activation failure. The host records the state of plugins that implement either hook in workspace data `bin/data/plugins-state.json` (`{schemaVersion: 1, plugins: {<id>: {settings}}}`) after activation, through a guarded workspace write whose `vault.*` records appear in the response, relative to the workspace root. A dry run calls the hooks but persists nothing, so the real run calls `onUserEnable` again. Entries for disabled plugins are dropped when the state is next written, so enabling a plugin again triggers `onUserEnable` again; a disable and re-enable between two activating invocations is not observed. Plugins that completed activation are recorded even when a later plugin fails. An unreadable state file is treated as empty, with a warning. When another invocation changed the state file after this one read it, the host rereads it, keeps that invocation's entries for enabled plugins it did not activate itself, adds its own and retries the write once; a write that still fails is a warning, not a command failure. `onUserEnable` therefore runs at least once, not exactly once: invocations that activate concurrently before either has recorded the state, a dry run followed by the real run, or a failed state write each call it again, so make it idempotent. `--no-plugins` and discovery commands leave the state untouched. Release archives omit this file.

`context.events.onLayoutReady(callback)` is the equivalent of Obsidian's `app.workspace.onLayoutReady`. Before every plugin has activated, callbacks are queued; after the last `onload`, the host runs them in registration order, awaiting each, and then emits `workspace.layout-ready` before the command runs. A callback registered later runs immediately. Callback failures become warnings. Do not await work that waits for layout readiness inside `onload`.

`context.events.onQuit(task)` registers best-effort invocation-end work, like the `tasks` of Obsidian's `quit` event. At invocation end, after success or failure, the host emits `workspace.quit` with `{}`, settles immediate layout callbacks, runs quit tasks in registration order (including tasks added by quit listeners), and only then unloads plugins. Task failures become warnings and never change the command result.

## Event delivery and invocation replay

File records of `vault.create`, `vault.modify` and `vault.delete` contain `path`, `kind: "file"`, SHA-256 `revision`, byte count `bytes`, and `operation` (`created`, `updated`, or `deleted`). For deletion, revision and bytes identify the removed content. A batch first emits `vault.create` with `{path, kind: "folder", operation: "created"}` for each directory it created, parent before child, in the order the batch created them; then one `vault.rename` per moved folder or file; then one record per written or removed file in batch order; then `vault.delete` with `{path, kind: "folder", operation: "deleted"}` for each removed folder, child before parent. Moving to the trash is reported like Obsidian's `trashFile`: `vault.delete` for each trashed file, then each trashed folder, with no records for the hidden `.trash` folders; the content is retained under `.trash`. Like Obsidian, there is no load-time `create` burst: the CLI has no long-lived vault. Paths are relative to the command root reported in the response context: the environment for project management, or the selected project for file commands. Claude user-scope commands report their configuration root separately in `data.target.directory`. Events follow successful persistence; batch write events wait until the entire batch completes. Dry runs and failed writes emit no `vault.*` events. Folder paths created above a selected project's directory are outside its scope and are not reported.

Each invocation owns one bus. Payloads must be finite JSON data: primitives, arrays and plain objects; undefined, BigInt, nonfinite numbers, Dates, Maps and cycles are rejected. Definitions validate isolated snapshots before delivery, so a validator cannot mutate the recorded payload. Listeners run in registration order and are awaited. Each receives a cloned snapshot so mutation cannot affect other listeners or event history.

`on` returns an unsubscribe function; `once` unsubscribes before invoking its callback, including during reentrant emission. `onAny(listener)` subscribes to all future events, receiving an `EventRecord` with `id` and `payload`, and also returns an unsubscribe function. Named and all-event listeners share registration order. Removals during delivery take effect immediately. Listeners added during an emission join future emissions.

`await events.replay(listener)` delivers an isolated snapshot of the history retained when replay begins. It does not subscribe the listener, publish new events or reread previous invocations. Replay followed by subscription is not an atomic catch-up mechanism for concurrent emitters. Replay listeners are awaited; their failures become warnings. Recursion is bounded to 32 active ancestors in the same asynchronous delivery chain, including replay and delivery across `await`. Independent concurrent emissions and parallel sibling emissions do not consume one another's recursion budget. Completed ancestors do not count against notifications scheduled for a later turn. History retains the first 1,000 events; later events still reach live listeners but are absent from history and replay, with a truncation warning. Warnings are capped at 1,000.

For example, observe the routed command that began before activation, then subscribe to future host and plugin events without logging to stdout:

```ts
import type { EventRecord, HostEventMap, Plugin } from '../bin/data/types/sdk.js';

const observedIds: string[] = [];
const observe = (record: EventRecord) => {
  if (observedIds.length < 1000) observedIds.push(record.id);
};
let unsubscribe: (() => void) | undefined;
let unsubscribeFailure: (() => void) | undefined;

export default {
  async onload(context) {
    await context.events.replay(observe);
    unsubscribe = context.events.onAny(observe);
    unsubscribeFailure = context.events.on<HostEventMap['operation.failed']>(
      'operation.failed',
      payload => context.events.warn(`Observed ${payload.operation}: ${payload.error.code}`),
    );
  },
  onunload() {
    unsubscribeFailure?.();
    unsubscribe?.();
  },
} satisfies Omit<Plugin, 'manifest'>;
```

Synchronous throws and asynchronous listener rejections become warnings and delivery continues. Host observers cannot veto operations, replace original failures or undo committed work, even on a `started` event. Callbacks must settle; arbitrary Node plugin code has no forced timeout. Cleanup continues in reverse order after failures. A listener that unsubscribes inside its own cleanup will not receive the later `plugin.unloaded` event. Dispose removes subscriptions and rejects later bus use. Records appear in the command result; history is neither persistent replay nor a filesystem watcher.

For recovery, inspect the original `error`, native result details and committed `vault.*` records together. A command failure can follow successful writes, and a Claude failure can follow a successful native exit whose output could not be parsed. A listener warning alone does not justify retrying a write. Reread affected state and its revision before retrying; phase success during a dry run is only a preview.
