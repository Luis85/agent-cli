# Localhost server

[Documentation](../index.md) · Reference

The core server provides a read-only inspection API and serves separately packaged webviews. Its lifecycle belongs to the portable CLI: no application package installation, separate development server or browser prompt is needed to use the packaged admin view. The Vue and Nuxt UI admin project lives independently in `src/forge-admin`; the server does not import its source or depend on its framework.

## Commands

All server commands run at workspace scope, bypass plugin activation and leave project selection unchanged. A stale project selection does not prevent server discovery or shutdown. `server` without an action is read-only `server status`.

| Usage | Effect |
| --- | --- |
| `server status` | Inspect the saved workspace server and verify its health without starting it or modifying saved state. Discover installed webviews even when the server is stopped. |
| `server start [--port <0..65535>] [--webview <id>] [--dry-run]` | Start a background localhost server or reuse the workspace's running server. Port `0` (the default) chooses an available port. `--webview admin` selects the installed admin view's launch URL. |
| `server stop [--dry-run]` | Stop the verified server belonging to this workspace. Repeating a completed stop has no further effect. |

`--port` and `--webview` are accepted only with `start`. Webview IDs are lowercase kebab-case names from the installed webview catalog. An unknown ID is `INVALID_ARGUMENT`. The CLI returns JSON; it never opens a browser, asks a question or holds the terminal open. The agent may offer to start the view as part of a conversation and then run the command when startup is authorized.

```sh
node bin/forge.js server status --json
node bin/forge.js server start --webview admin --dry-run
node bin/forge.js server start --webview admin --json
node bin/forge.js server stop --dry-run
node bin/forge.js server stop --json
```

Use `--root <workspace>` before the command to target another workspace. Use `--no-dry-run` to explicitly override an enabled `settings.dryRun` when applying a reviewed startup or shutdown.

## Response

Successful responses use the standard envelope. `data` contains:

| Field | Meaning |
| --- | --- |
| `running` | A server responded to its authenticated identity/health check. |
| `stale` | Saved server state exists but its recorded server could not be verified as running. |
| `server` | Runtime identity and health: `pid`, `startedAt`, `host`, `port`, `version`, `nodeVersion`, `uptimeSeconds`; otherwise `null`. |
| `url` | Local launch URL when running; otherwise `null`. With `--webview <id>` it opens `/views/<id>/` and carries that view's read-only token in its fragment; without it, it opens the public view catalog `/` and carries no token. |
| `webviews` | Views with `id`, `name` and `path`: the running server's mounted catalog, or the installed catalog when inspecting an inactive server with `status`. An inactive startup preview also lists installed views. Stop responses do not discover installed assets. |
| `changed` | Required on start/stop: whether the invocation changed lifecycle state, or would change it during a dry run. |
| `dryRun` | Present as `true` for a lifecycle preview. No process is started/stopped and no server state is written. |

A preview of an inactive server cannot supply the future ephemeral port or a valid launch link. Repeated startup reuses the current process and reports `changed: false`; it does not silently restart a running server on a new requested port. Stop and then start to change the port. `status` does not remove stale records.

`status` returns a link to the server's JSON view catalog, without a token, not directly to the admin page. To recover an admin tab after losing its token or closing the browser, run `server start --webview admin` again and open its complete `data.url`. This reuses a healthy server; it does not change project selection.

## Inspection and access

The server binds only to IPv4 loopback, `127.0.0.1`. There is no public bind/host option. Its protected API requires a bearer token. The server token stays in the private `.forge/server.json` for the CLI; a view's launch URL carries only a token derived for that view in its fragment (`#token=…`). A view token reads `/api/health` and `/api/system` but cannot stop the server, and tokens for views the server does not mount are refused, so a project-published view never receives the server token. Treat that URL as local access information and avoid putting it in commits or shared logs. Shutdown invalidates the session; use a fresh CLI launch link after restarting.

The admin view reports workspace context, selected project, managed projects, plugin availability, contribution counts and server runtime details. It does not edit configuration, change project selection, enable plugins or execute arbitrary CLI commands. Read-only describes the webview and inspection API; `server start` and `server stop` explicitly control a process and local lifecycle state.

The core API works without an admin bundle. Static webviews are separate distribution assets discovered by the server and served under `/views/<id>/`. Generated webview projects can optionally use the same inspection contract without replacing the server implementation. See [use the admin webview](../how-to/use-admin-webview.md) for the user workflow.

## Snapshot semantics

Inspection runs only these fixed discovery commands against the server's workspace: `config`, `project list`, `project current`, `plugins` and `help`. They run with `--dry-run` and no emitted events. They discover trusted plugin modules without activating plugin lifecycle hooks. Snapshots use the workspace's current configured plugin state: `--no-plugins` on the initiating CLI command affects that invocation only; it does not persist a different plugin policy in the server.

`stats.commands`, `stats.generators` and `stats.skills` count the registered catalog returned by `help`, including kernel commands. They describe discovered capabilities, not completed work, loaded browser extensions or invocation history. `stats.enabledPlugins` counts plugins whose report state is `enabled`; unavailable and disabled plugins remain visible in the plugin list. The API projects selected configuration fields and generic plugin-unavailability reasons; it does not return the raw configuration document or arbitrary plugin diagnostic text.

The server caches a collected snapshot for three seconds and shares a pending collection between concurrent requests. Runtime uptime is refreshed when a cached snapshot is returned. `updatedAt` identifies when the inspection snapshot was collected. The admin view polls every 15 seconds while auto-refresh is enabled and the tab is visible, refreshes when the tab becomes visible, and offers manual refresh. Manual refresh can still receive the server's three-second cached snapshot.

Failed individual discovery commands produce `warnings` and set the corresponding `availability` flag to `false`. The admin view labels those sections unavailable instead of presenting their empty/null placeholders as confirmed state. For example, a stale selection can leave `selectedProject: null` with a warning; it does not block the remaining inspection. Empty counts accompanied by warnings do not establish that the workspace contains no projects or plugins. Run the named CLI discovery command to diagnose the failure.

Malformed discovery responses also mark their section unavailable. A successful command that reports warnings retains its data and availability, with a generic warning directing you to that CLI command for details. The snapshot does not include arbitrary warning text from plugins.

If the HTTP request fails or its response cannot be parsed, the admin view retains its last successful snapshot and labels the connection failure and last update time. Displayed data is then historical, not proof that the server remains healthy. Missing or expired authentication requires a fresh launch link; repeated malformed responses require matching CLI and webview assets. `server status`'s lifecycle `stale` flag describes saved process state and is separate from the age of a browser snapshot.

## HTTP contract

Use the origin returned by the CLI, including its assigned port. Requests must use that exact `127.0.0.1` host; browser requests must be same-origin. Every `/api/` request requires `Authorization: Bearer <token>`. A custom view can consume the launch URL's `token` fragment, remove it from the address bar, and send it as the authorization header. Do not move the token into a query parameter.

| Endpoint | Contract |
| --- | --- |
| `GET /api/system` | Read-only inspection: `{ok:true,data:<SystemSnapshot>}` with `data.schemaVersion: 1`. |
| `GET /api/health` | Read-only server identity: `{ok:true,data:{schemaVersion:1,instanceId,pid,startedAt}}`. |
| `POST /api/shutdown` | Lifecycle control used by `server stop`: `{ok:true,data:{stopping:true}}`. It requires the server token, so a view token gets 403 `SERVER_FORBIDDEN`. It is not a workspace/configuration mutation API; lifecycle management stays with the CLI. |
| `GET /` | Public packaged-view catalog: `{ok:true,data:{views:[{id,name,path}]}}`; no workspace inspection data. |
| `GET` or `HEAD /views/<id>/…` | Public static assets for the named installed webview. The protected API supplies workspace data separately. |

`SystemSnapshot` version 1 contains `updatedAt` (ISO timestamp), `server` (the runtime fields above), `workspace: {root, projectsPath, selectedProject}`, `projects`, `plugins`, `stats`, `webviews`, `availability` and `warnings`. `availability` contains boolean flags `{config,projects,selectedProject,plugins,capabilities}`; a false flag means the corresponding data could not be inspected. Each project has `{schemaVersion,name,type,directory}`. Each plugin has `{id,name,version,core,state,description,commands,generators,skills,reason?}`. Statistics are numeric `{projects,plugins,enabledPlugins,commands,generators,skills}`; warnings are strings; view entries are `{id,name,path}`. These HTTP envelopes do not include the CLI's `context` or `events` fields. Consumers must check `ok` and `schemaVersion` before using the data.

HTTP failures use `{ok:false,error:{code,message}}`: 400 `SERVER_BAD_REQUEST`, 401 `SERVER_UNAUTHORIZED`, 403 `SERVER_FORBIDDEN`, 404 `SERVER_NOT_FOUND`, 405 `SERVER_METHOD_NOT_ALLOWED` (with `Allow`) or 500 `SERVER_INTERNAL_ERROR`. These transport codes are separate from the CLI lifecycle errors below. Inspection failures within an otherwise usable snapshot appear in its `warnings` instead of changing HTTP success to failure.

## Package another webview

Use `project create <id> --type webview` for an independent Vue/Nuxt UI starter, then build it and run `node bin/forge.js webview publish --project <id> --dry-run` before publication. See [prototype a webview](../how-to/prototype-webviews.md) and [the guarded publication contract](webviews.md). The server remains framework-independent; custom static projects can also follow the asset contract below.

Build each webview in its own project and export only static output into `bin/webviews/<id>/`. That directory must include a readable `index.html` and a `manifest.json`:

```json
{"id":"example-view","name":"Example view","entry":"index.html"}
```

The lowercase kebab-case `id` must match its directory name. The display name must be nonempty and `entry` must be exactly `index.html`. Invalid manifests or missing entry assets are skipped. Webview mounts are discovered when the server starts; stop and start after adding a view or changing its manifest to refresh the running catalog. `start --webview <id>` on an existing server selects from that server's catalog. Rebuilding and packaging an existing view's assets only requires a browser reload: HTML is not cached and other static files require revalidation.

Build asset URLs relative to `/views/<id>/` or use relative asset paths. The server serves explicit files only: it provides no SPA history fallback, directory listing, workspace-file mount or framework development middleware. Use client-side hash routing or package explicit HTML entry files. Dotfiles, the manifest and symlinked assets are not served. The same-origin content policy requires locally packaged scripts, styles, fonts and images; external CDNs are not available.

Launch the installed view with `node bin/forge.js server start --webview example-view --json`. This selects its authenticated URL without coupling the core server to its framework.

## Errors and recovery

| Code | Recovery |
| --- | --- |
| `INVALID_ARGUMENT` | Check the action, port range or installed webview ID with `help server` and `server status`. |
| `SERVER_START_FAILED` | Inspect the diagnostic; check the requested port and packaged runtime, then retry with port `0` or repair the distribution. |
| `SERVER_STOP_FAILED` | Inspect the diagnostic and run `server status` to verify whether the original server is still reachable. |
| `SERVER_STATE_INVALID` | Inspect the reported server-state path and diagnostic before repairing local state. |
| `SERVER_BUSY` | Another lifecycle operation owns the server lock; wait for it to finish, then inspect status and retry. |

The CLI verifies the saved server identity; it does not kill an unrelated process based only on a stale PID. `schema server --json` provides exact input/output contracts and current error metadata.
