# Enable or disable a plugin

[Documentation](../index.md) · How-to guide

Use this guide to scaffold, review and activate a trusted plugin in an existing workspace. For contribution types and lifecycle behavior, see the [plugin API](../reference/plugins.md).


```sh
node bin/app.js make plugin Quality
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
node bin/app.js plugins --json
node bin/app.js quality.hello
```

Only IDs in `plugins.enabled` execute; directory scanning never enables unreviewed code. Put `--no-plugins` before the command to skip them for one invocation, including when an enabled plugin fails to load. IDs must match their directory and manifest. Plugins load from workspace `bin/plugins` and are shared across its projects. Symlink modules are rejected. Plugins are trusted Node code with the process's permissions and can bypass workspace guards; review modules and dependencies before enabling them.
