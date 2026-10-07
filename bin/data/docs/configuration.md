# Workspace configuration

The app reads the selected workspace's fixed `bin/config.json`. By default, the workspace is the parent of the executable's `bin` directory. `--root <directory>` selects another workspace and reads that workspace's `bin/config.json`; the current working directory does not change the default workspace. A missing configuration uses built-in defaults. `node bin/app.js config --json` returns `data:{path,root,config}` with the configuration source, resolved workspace root and effective settings.

The shipped configuration is:

```json
{
  "schemaVersion": 1,
  "paths": {
    "projects": "projects"
  },
  "settings": {
    "json": false,
    "dryRun": false
  },
  "templates": {
    "dateFormat": "YYYY-MM-DD",
    "timeFormat": "HH:mm"
  },
  "plugins": {
    "enabled": []
  }
}
```

Configuration is validated with Zod. Partial objects inherit defaults; unknown keys and invalid values fail before execution. `paths.projects` is relative to that workspace and defaults to `projects`; set it to `src` or another contained directory for managed projects.

The workspace layout is fixed: `bin/app.js` is the executable, `bin/config.json` holds settings, `bin/plugins` contains shared plugins, `bin/templates` contains shared Markdown templates, and `bin/data` holds bundled assets and `context.json`. These `bin` paths are not configurable. Keep the complete distribution together when copying it.

`project open <id>` saves the active project in `bin/data/context.json`; `project current` reports it and `project close` returns to workspace scope. Document paths and generated source are relative to the active project, or the workspace when none is selected. Document generation defaults to `notes`, TypeScript generation to `src/domain`, and skill installation to `.agents/skills` within that scope. `--out` overrides a command's output directory. Templates and plugins remain shared under the workspace's `bin` folder. See [project contexts](projects.md).

Command-line values take precedence: `--root` selects the workspace and `--json` / `--no-json` and `--dry-run` / `--no-dry-run` override settings. Put routing options `--root` and `--no-plugins` before the command, for example `node bin/app.js --root /path/to/workspace setup --dry-run`. Formatting and dry-run flags may appear on either side of the command. Do not pass `--json=false`; use the negated flag. `settings.json` controls compact formatting, not whether results use JSON.

Only IDs explicitly listed in `plugins.enabled` load from `bin/plugins`. Installing a directory does not enable it. Use `node bin/app.js --no-plugins <command>` to disable plugins for one invocation, including recovery from a broken plugin.

Keep workspace configuration under version control as appropriate for your repository. The persisted project selection is local operating state. For upgrades, extract separately; preserve configuration, shared plugins/templates and current context while replacing the executable and packaged assets.
