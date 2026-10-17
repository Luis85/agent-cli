# Backlog sync with Azure DevOps Boards

Read this before running `backlog sync` or when a sync reports skips, conflicts or errors.

## Connections and tokens
- Connections live in `bin/config.json` under `plugins.settings.connector.connections.<id>` (`platform`, `organization`, `project`, `process`, `iterationRoot`, `tokenEnv`).
- The token comes only from the environment variable that `tokenEnv` names (default `AZURE_DEVOPS_EXT_PAT`). Never print it or write it to config or notes.
- The token goes only to `dev.azure.com`, `*.visualstudio.com` and loopback. Another host, such as an Azure DevOps Server, must be listed in the user's `FORGE_CONNECTOR_ALLOWED_HOSTS` (comma-separated); until then requests fail with `CONNECTION_INVALID` (`details.host`) before anything is sent.
- Check with `connectors list` (`valid`, `tokenSet`), `connectors inspect <id>` (mappings) and `connectors test <id>` (a read-only probe).
- A `product-backlog` view with the option `connection: <id>` is a sync set.

## Sync
- Always start with `backlog sync status` or `backlog sync --dry-run`. It reads the remote and lists `created`, `updated`, `pulled`, `conflicts` and `skipped` per view, and `left` per connection.
- A skip is never an error to work around: read its `code` (`duplicate-link` for a copied note, `remote-format-unknown`, `server-kept`, `unexpressible`, `unsynced-dependency`) and tell the user.
- Then `backlog sync`, optionally `--direction push|pull` and `--view` to narrow.
- Remote items without a note are never imported: create the note with `backlog add`.
- Rename notes with `move` or `rename` so the sync state follows. Never edit the link property (`azure-devops`) or `.forge/sync/<id>.json` by hand, and never copy a note with its link property.
- With `dependsOnProperty` bound, dependencies sync as predecessor links: edit them with `backlog depend` and `undepend`, never as raw ids.
- Without the state file, notes relink by their link property and every differing field is a conflict; nothing is overwritten.

## Conflicts and errors
- A field changed on both sides is a conflict the sync leaves alone. Ask which side wins, then `backlog sync resolve <item> --take local|remote [--field title,state]`.
- `WORKSPACE_BUSY` naming `.forge/sync/<id>.lock`: another sync of that connection runs. Wait and retry while `retryable` is true; a lock left by a killed sync is removed with a warning.
- `SYNC_INTERRUPTED` (exit 130 or 143): a signal stopped the sync at a safe point. Rerun `backlog sync status`, then `backlog sync`.
- `SYNC_CONFLICT`: the remote item changed during the sync. Rerun status and sync; if its links changed, compare the `parent` or `dependencies` conflicts in Azure DevOps with the user before resolving.
- `CONNECTOR_AUTH_FAILED`: the token variable is unset or rejected.
- `PLUGIN_SERVICE_MISSING` for `connector.hub`: the `connector` core plugin is disabled or its settings are invalid; `plugins` shows why.
