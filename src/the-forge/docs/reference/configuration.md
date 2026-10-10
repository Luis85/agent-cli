# Workspace configuration

[Documentation](../index.md) · Reference

The app reads the selected workspace's fixed `bin/config.json`. By default, the workspace is the parent of the executable's `bin` directory. `--root <directory>` selects another workspace and reads that workspace's `bin/config.json`; the current working directory does not change the default workspace. A missing configuration uses built-in defaults. `node bin/forge.js config --json` returns `data:{path,root,config}` with the configuration source, resolved workspace root and effective settings.

The shipped configuration is:

```json
{
  "schemaVersion": 1,
  "paths": {
    "projects": "projects"
  },
  "settings": {
    "language": "en",
    "json": false,
    "dryRun": false,
    "events": "changes"
  },
  "plugins": {
    "enabled": [],
    "disabled": [],
    "settings": {}
  }
}
```

Configuration is validated with Zod. Partial objects inherit defaults; unknown keys and invalid values fail before execution. `paths` holds only `projects`; feature folders live in their core plugin's section under `plugins.settings`. `paths.projects` is relative to that workspace and defaults to `projects`; set it to `src` or another contained directory for managed projects.

The Forge source checkout deliberately overrides this default: its tracked `bin/config.json` uses `paths.projects: "src"`, and tracked `bin/data/context.json` selects `the-forge` at `src/the-forge`. Generic release archives use the defaults shown above and contain no saved selection. Setup preserves existing settings and context; it does not convert a copied checkout configuration into generic defaults. Follow the [new-workspace installation steps](../tutorials/getting-started.md#1-install-the-portable-distribution) when copying the repository bundle elsewhere.

The workspace layout is fixed: `bin/forge.js` is the executable, `bin/config.json` holds settings, `bin/plugins` contains shared plugins, `bin/templates` contains shared Markdown templates, `bin/skills` holds the packaged process skills, `bin/config/default.json` holds shipped defaults, and `bin/data` holds bundled assets and `context.json`. These `bin` paths are not configurable. Keep the complete distribution together when copying it.

`project open <id>` saves the active project in `bin/data/context.json`; `project current` reports it and `project close` returns to workspace scope. Document paths and generated source are relative to the active project, or the workspace when none is selected. Document generation defaults to `notes`, TypeScript generation to `src/domain`, and skill installation to `.agents/skills` within that scope. `--out` overrides a command's output directory. Templates and plugins remain shared under the workspace's `bin` folder. See [project contexts](../how-to/manage-projects.md).

Command-line values take precedence: `--root` selects the workspace and `--json` / `--no-json`, `--dry-run` / `--no-dry-run` and `--events` override settings. `settings.events` (`none`, `changes` or `all`, default `changes`) selects which events the response envelope carries; see [output and errors](cli.md#output-and-errors). It never changes listener delivery or replay. `config` reports the effective level. Put routing options `--root` and `--no-plugins` before the command, for example `node bin/forge.js --root /path/to/workspace setup --dry-run`. Formatting, dry-run and `--lang en|de` flags may appear on either side of the command. `settings.language` defaults to `en`; `--lang` overrides it for the invocation. `config` reports the effective language, and `setup --lang de` stores it when creating a missing configuration. Existing configuration files are preserved. See [language selection and diagnostic scope](language.md). Do not pass `--json=false`; use the negated flag. `settings.json` controls compact formatting, not whether results use JSON.

UI generation belongs to the `ui` core plugin, whose section `plugins.settings.ui` holds its settings without changing the fixed `bin` layout. Folders must be contained relative paths; a trailing slash is dropped. The former kernel keys `paths.components`, `paths.ui`, `paths.stories`, `paths.componentImports`, `paths.componentExports`, `paths.interactions*` and `ui.framework` are rejected with `INVALID_CONFIG`; move them into this section:

| Setting in `plugins.settings.ui` | Default | Scope and override |
| --- | --- | --- |
| `framework` | `html` | `html`, `htmx`, `vanilla`, `vue`, `svelte`, `react` or `angular`; `--framework` |
| `components` | `components` | Workspace component library; `--library` |
| `interactions` | `interactions` | Workspace interaction library; management `--library`, UI/component `--interactions-library` |
| `interactionImports` | `imports/interactions` | Workspace import source; `interactions import --from` |
| `interactionExports` | `exports/interactions` | Workspace export destination; `interactions export --out` |
| `output` | `src/ui` | Active project or workspace; `make ui/stories --out` |
| `stories` | `stories` | Active project or workspace; `--stories-out` |
| `componentImports` | `imports/components` | Workspace import source; `components import --from` |
| `componentExports` | `exports/components` | Workspace export destination; `components export --out` |

For example, `{"plugins": {"settings": {"ui": {"framework": "react", "output": "src/components"}}}}` makes React the default target and writes generated components to `src/components` of the selected project. An invalid section makes the `ui` plugin unavailable with a warning: `components`, `interactions`, `make ui` and `make stories` then fail with `PLUGIN_UNAVAILABLE` and list the problems in `error.details.issues`.

`components` commands always manage the workspace library. UI and story output follows the selected project. `make ui/stories --project <id>` selects a project for that invocation without changing the persisted selection; otherwise the open project is used. Both default directories and explicit `--out`/`--stories-out` paths are relative to that selected project, or to the workspace when none is selected. The library and Storybook extension module paths remain workspace-relative. Inspect the response's `context` to verify the destination. See [UI components](ui-components.md).

The `plugins` section has three keys:

| Key | Default | Meaning |
| --- | --- | --- |
| `plugins.enabled` | `[]` | User plugin ids that load from `bin/plugins`, in load order. Installing a directory does not enable it |
| `plugins.disabled` | `[]` | Bundled core plugin ids to turn off, such as `["skills"]`. Core plugins are enabled by default; other ids are ignored with a warning. A plugin that requires a service of a disabled core plugin becomes unavailable (`backlog` without `bases`) |
| `plugins.settings` | `{}` | One config section per plugin id, validated against the JSON Schema that the loaded plugin declares; defaults fill missing values and `config` shows the effective result. An invalid section makes only that plugin, and plugins that require its services, unavailable, with a warning: their commands fail with `PLUGIN_UNAVAILABLE`. Sections naming no installed plugin are kept with a warning. Core plugins declare sections too: `search.timeoutMs` bounds [search matching](search.md#regular-expression-safety), `links.roots` lists entry notes that are never [orphans](links.md#orphans-and-dead-ends), `agents.directory` and `agents.defaultModel` configure [agent definitions](agents.md), `backlog.base`/`backlog.view` choose the default [backlog](backlog.md#choosing-the-backlog), `connector.connections` holds the [connection profiles](connectors.md#connection-profiles) of backlog sync, `templates.dateFormat`/`templates.timeFormat` (defaults `YYYY-MM-DD` and `HH:mm`) set the dayjs formats of [template](templates.md) `{{date}}` and `{{time}}` placeholders without their own format, `ui` holds the UI framework and folders described above, and `data-sources` the data-source folders described below. See [config sections](plugins.md#config-sections) |

Connection profiles to external work trackers live in this workspace configuration, one entry per connection, so one repository can sync different backlog views to different organizations and projects. They never hold secrets: `tokenEnv` names the environment variable with the access token.

```json
{
  "plugins": {
    "settings": {
      "connector": {
        "connections": {
          "contoso": { "platform": "azure-devops", "organization": "https://dev.azure.com/contoso", "project": "Trailhead", "process": "agile", "iterationRoot": "Trailhead" },
          "fabrikam": { "platform": "azure-devops", "organization": "https://dev.azure.com/fabrikam", "project": "Delivery", "process": "scrum", "tokenEnv": "FABRIKAM_PAT" }
        }
      }
    }
  }
}
```

See [connectors](connectors.md) for every field and the [Azure DevOps connector](connector-azure-devops.md) for its platform fields and mappings.

Use `node bin/forge.js --no-plugins <command>` to skip user plugins for one invocation, including recovery from a broken plugin; core plugins still load. `node bin/forge.js plugins` lists every plugin with its state.

Keep workspace configuration under version control as appropriate for your repository. Persisted selection is operating state; this source checkout intentionally tracks its self-management selection. For upgrades, extract separately; preserve configuration, shared plugins/templates and current context while replacing the executable and packaged assets.

Data sources belong to the `data-sources` core plugin, whose section `plugins.settings.data-sources` holds its folders. The former kernel keys `paths.dataSources`, `paths.dataGenerated`, `paths.dataFixtures`, `paths.dataImports` and `paths.dataExports` are rejected with `INVALID_CONFIG`; move them into this section:

| Setting in `plugins.settings.data-sources` | Default | Scope and override |
| --- | --- | --- |
| `library` | `data-sources` | Workspace definition library; `--library` |
| `imports` | `imports/data-sources` | Workspace import source; `data-sources import --from` |
| `exports` | `exports/data-sources` | Workspace export destination; `data-sources export --out` |
| `output` | `src/data-sources` | Generated adapters in the selected project or workspace; `make data-source --out` |
| `fixtures` | `test-data` | Generated test data in that same scope; `make data-source --test-data-out` |

See [data-source contracts](data-sources.md) for supported adapters and exact input resolution.
