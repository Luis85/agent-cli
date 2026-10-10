# Enable or disable a plugin

[Documentation](../index.md) · How-to guide

Use this guide to scaffold, review and activate a trusted plugin in an existing workspace. For contribution types and lifecycle behavior, see the [plugin API](../reference/plugins.md).


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

Only IDs in `plugins.enabled` execute; directory scanning never enables unreviewed code. Put `--no-plugins` before the command to skip them for one invocation, including when an enabled plugin fails to load. IDs must match their directory and manifest. Plugins load from workspace `bin/plugins` and are shared across its projects. Symlink modules are rejected. Plugins are trusted Node code with the process's permissions and can bypass workspace guards; review modules and dependencies before enabling them.

Inspect available notifications with `node bin/forge.js events --json`. Event discovery includes descriptions for the host's Obsidian-style `vault.*`, `metadataCache.*` and `workspace.*` events, the `command.*`, `operation.*`, Claude and plugin lifecycle phases, and plugin-defined events. `data.hostNamespaces` lists the namespaces only the host may emit. Discovery registers contributions without running `onload`; it does not test a plugin's observers.

The [quality example](../examples/plugins/quality/main.mjs) demonstrates named listeners, `onAny` for future notifications and awaited `replay` for the retained history of the current invocation. Register observers in `onload` and release subscriptions in `onunload`. Command start and registration can precede activation, so use replay explicitly if you need those earlier records. Replay is bounded and does not load events from an earlier CLI run.

After an operation, inspect the response's original error, warnings and events together. Observers cannot veto work: a warning can follow a committed write, and a command can fail after changing state. Responses include only committed `vault.*` records by default; rerun with `--events all` to see lifecycle, workspace and plugin records in the envelope. Match started/terminal phase records by `operationId` and inspect `root` or `cwd` before interpreting paths. Check committed `vault.*` records and reread affected files before retrying. Low-level repository calls and arbitrary plugin code do not automatically produce operation phases; see the [event contract](../reference/plugins.md#host-events-and-correlation).
