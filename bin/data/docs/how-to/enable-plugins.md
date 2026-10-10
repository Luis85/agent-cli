# Enable or disable a plugin

[Documentation](../index.md) · How-to guide

Use this guide to scaffold, review and activate a trusted user plugin, to configure a plugin's settings, and to turn a bundled core plugin off or on. For contribution types and lifecycle behavior, see the [plugin API](../reference/plugins.md).

## List the plugins

```sh
node bin/forge.js plugins --json
```

Core plugins such as `skills` come first with `core: true`; user plugins follow. `state` is `enabled`, `unavailable`, `disabled`, `skipped` or `rejected` with a `reason` for every state but `enabled`, and `contributions` lists what each enabled plugin adds.

## Enable a user plugin

```sh
node bin/forge.js make plugin Quality
```

The generator creates `quality/manifest.json` and `quality/main.mjs` under workspace `bin/plugins`, including while a project is open. This location is fixed; `make plugin` rejects `--out`. Review the code, then add the directory ID to `bin/config.json`:

```json
{
  "schemaVersion": 1,
  "paths": { "projects": "projects" },
  "plugins": { "enabled": ["quality"] }
}
```

```sh
node bin/forge.js plugins --json
node bin/forge.js quality.hello
```

Only IDs in `plugins.enabled` execute; directory scanning never enables unreviewed code, and `plugins` lists an installed but unlisted plugin as `disabled` without running it. Put `--no-plugins` before the command to skip user plugins for one invocation, including when an enabled plugin fails to load. IDs must match their directory and manifest. Plugins load from workspace `bin/plugins` and are shared across its projects. Symlink modules are rejected. Plugins are trusted Node code with the process's permissions and can bypass workspace guards; review modules and dependencies before enabling them.

To disable a user plugin, remove its id from `plugins.enabled`.

## Configure a plugin's settings

A plugin that declares a config section reads it from `plugins.settings.<id>`. Run `config` to see each section's schema in `data.sections` and its effective values, defaults included, in `data.config.plugins.settings`:

```json
{ "plugins": { "enabled": ["quality"], "settings": { "quality": { "ownerProperty": "maintainer" } } } }
```

An invalid value makes only that plugin unavailable for the invocation: every response carries a warning naming the path, such as `plugins.settings.quality.ownerProperty`, `plugins` lists the plugin with `state: "unavailable"` and a `reason`, and its commands and generators fail with `PLUGIN_UNAVAILABLE`, with the reason in `error.details.reason` and the issues in `error.details.issues`. `config`, `help`, `plugins` and every other command keep working, so you can inspect and fix the file. A section whose id names no installed plugin, such as a misspelled `serach`, is kept and reported in a warning. After a change, the plugin's `onExternalSettingsChange` hook runs on its next activation.

## Disable or re-enable a core plugin

Core plugins are bundled and enabled by default. List their ids under `plugins.disabled` to turn them off:

```json
{ "plugins": { "disabled": ["skills"] } }
```

The bundled core plugins are `bases`, `skills`, `search`, `links`, `agents`, `connector`, `connector-azure-devops` and `backlog`; see [bundled core plugins](../reference/plugins.md#bundled-core-plugins). For example, disabling `bases` removes the `bases` command while `.base` files stay ordinary documents for `read`, `validate` and `patch`. It also leaves `backlog` without the `bases.query` service it requires: `backlog` stays listed by `help` and `plugins`, `plugins` shows it as `unavailable` with its `reason`, and `backlog` commands fail with `PLUGIN_UNAVAILABLE` until `bases` is enabled again. An optional service never does that: disabling `connector` makes `connector-azure-devops` unavailable, while `backlog` stays enabled and only `backlog sync` fails with `PLUGIN_SERVICE_MISSING`. Core plugins configure through `plugins.settings` like user plugins: `search.timeoutMs`, `links.roots`, `agents.directory` and `agents.defaultModel`, `backlog.base`/`backlog.view`, and `connector.connections`.

A disabled core plugin contributes nothing: `help` and `schema` no longer list its commands, and its skills and services are gone. `plugins` still lists it with `state: "disabled"`. Remove the id from `plugins.disabled` to restore it; its first activation afterwards runs `onUserEnable` again. Other ids there are ignored with a warning rather than blocking the CLI, and `--no-plugins` never disables core plugins.

## Observe events

Inspect available notifications with `node bin/forge.js events --json`. Event discovery includes descriptions for the host's Obsidian-style `vault.*`, `metadataCache.*` and `workspace.*` events, the `command.*`, `operation.*`, Claude and plugin lifecycle phases, and plugin-defined events. `data.hostNamespaces` lists the namespaces only the host may emit. Discovery registers contributions without running `onload`; it does not test a plugin's observers.

The [quality example](../examples/plugins/quality/main.mjs) demonstrates named listeners, `onAny` for future notifications and awaited `replay` for the retained history of the current invocation. Register observers in `onload` and release subscriptions in `onunload`. Command start and registration can precede activation, so use replay explicitly if you need those earlier records. Replay is bounded and does not load events from an earlier CLI run.

After an operation, inspect the response's original error, warnings and events together. Observers cannot veto work: a warning can follow a committed write, and a command can fail after changing state. Responses include only committed `vault.*` records by default; rerun with `--events all` to see lifecycle, workspace and plugin records in the envelope, including those of core plugins. Match started/terminal phase records by `operationId` and inspect `root` or `cwd` before interpreting paths. Check committed `vault.*` records and reread affected files before retrying. Low-level repository calls and arbitrary plugin code do not automatically produce operation phases; see the [event contract](../reference/plugins.md#host-events-and-correlation).
