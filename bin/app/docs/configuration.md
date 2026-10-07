# Project configuration

The app reads `config.json` beside its `app` directory, normally `bin/config.json`. `--config <path>` selects another file. A selected explicit configuration must exist; without an implicit file the CLI uses its built-in defaults and the current working directory as the project root. `node bin/app config --json` shows the effective configuration.

The shipped configuration is:

```json
{
  "schemaVersion": 1,
  "paths": {
    "root": "..",
    "projects": "projects",
    "templates": "templates",
    "output": "notes",
    "generated": "src/domain",
    "plugins": ".agent-cli/plugins",
    "skills": ".agents/skills"
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

Configuration is validated with Zod. Partial objects inherit defaults; unknown keys and invalid values fail before executing a command. `schemaVersion` is 1. `paths.root` resolves relative to the configuration file, so the default `..` selects the project containing `bin`, even when invoked from another working directory. All remaining paths are relative to the selected root and obey the same containment rules as file operations.

Command-line values take precedence: `--root` selects another workspace, `--out` overrides the command's configured output directory, and `--json` / `--no-json` and `--dry-run` / `--no-dry-run` override settings. Put routing options `--root`, `--config` and `--no-plugins` before the command, for example `node bin/app --config custom.json --root /path/to/project setup --dry-run`. Formatting and dry-run flags may appear on either side of the command. Do not pass `--json=false`; use the negated flag. `settings.json` controls compact formatting, not whether results use JSON. All results are JSON envelopes.

`paths.projects` contains managed TypeScript library projects; set it to `src` if that fits your repository. `paths.templates` is the Markdown template source directory. `paths.output` is the destination for `make document`; `paths.generated` is the default for TypeScript generators. `paths.plugins` contains plugin directories and is also the default for `make plugin`. `paths.skills` is the default installation directory for process skills. See [project workflows](projects.md), [templates](templates.md) and [plugins](plugins.md).

Only plugin IDs explicitly listed in `plugins.enabled` load. Installing a directory does not enable it. Use `node bin/app --no-plugins <command>` to disable all configured plugins for one invocation, including recovery from a broken plugin.

Keep project-specific configuration under version control as appropriate for your repository. A release archive includes defaults: extract upgrades separately and preserve your configured paths and enabled plugins when replacing the executable.
