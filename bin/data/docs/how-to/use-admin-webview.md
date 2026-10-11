# Use the admin webview

[Documentation](../index.md) · How-to

Use the read-only admin view to inspect the workspace, project selection, installed plugins, contribution counts and runtime health while an agent works through the CLI. The complete `bin/` distribution includes the view; you do not need to install Vue, run npm or manage a separate web server to inspect it.

From the workspace root:

```sh
node bin/forge.js server status --json
node bin/forge.js server start --webview admin --json
```

Check that `ok` is `true` and open the returned `data.url` in a browser. The URL uses `127.0.0.1` and includes the local authentication token. Open the complete returned link, including its fragment. A default startup chooses an available port. Repeating the command reuses the workspace server, so it is safe for an agent to retrieve the launch link again.

The agent can offer to start this view when a visual overview would help. The CLI remains noninteractive: it prints one JSON response, does not open a browser and starts a background server only through an explicit `server start` invocation. `server status` alone never starts it.

The view refreshes every 15 seconds while its tab is visible and auto-refresh is enabled. Use its refresh control after CLI operations to request an update; the server may reuse a snapshot collected within the last three seconds. Configuration and plugin changes remain CLI/file workflows; the view offers no mutation controls. Runtime counts describe discovered contributions and availability, not a historical activity log or test results. If inspection reports unavailable state, read its warning and use the CLI's `config`, `project current` and `plugins` commands to diagnose it. A warning can mean that a displayed empty value could not be inspected; it does not prove that the underlying state is empty. The view reflects configured workspace plugins; passing `--no-plugins` to startup does not change its ongoing inspection policy.

To preview lifecycle changes or choose a port:

```sh
node bin/forge.js server start --webview admin --port 3000 --dry-run
node bin/forge.js server start --webview admin --port 3000
```

If a server is already running, startup reuses its existing port. To change that port, stop it first. A dry run never starts or stops a process. If workspace defaults enable dry runs, add `--no-dry-run` when applying the operation.

When finished:

```sh
node bin/forge.js server stop --json
node bin/forge.js server status --json
```

An open browser tab may show its last successful snapshot after shutdown or a failed refresh. Check the connection warning and last-updated time before treating displayed values as current. Start the server again and use its newly returned launch link to reconnect. Keep launch links private to the local session.

For a different workspace, place `--root <workspace>` before `server`; the currently selected project does not redirect server state. See [localhost server reference](../reference/server.md) for fields, lifecycle guarantees, errors and the independent API/webview boundary. The admin project's own README describes its Vue/Nuxt UI development toolchain and Playwright browser inspection/tests; the shipped view is always started and stopped through `node bin/forge.js server`.
