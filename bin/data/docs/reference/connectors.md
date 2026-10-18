# Connectors

[Documentation](../index.md) · Reference

Connectors link the [backlog](backlog.md) to external work trackers. Each platform is a self-contained connector behind one platform-neutral contract, so the backlog's sync engine works the same for every tracker. Azure DevOps Boards is the first platform ([Azure DevOps connector](connector-azure-devops.md)); GitHub Issues/Projects and Jira can follow on the same contract without changes to the backlog.

| Core plugin | Role |
| --- | --- |
| `connector` | The hub: connection profiles in workspace config, the `connectors` command, the `connector.*` events and the `connector.hub` service that platform connectors register with |
| `connector-azure-devops` | The Azure DevOps Boards connector; provides `connector-azure-devops.connector` and requires `connector.hub` |
| `backlog` | The sync engine (`backlog sync`); optionally uses `connector.hub` |

Disabling `connector`, or an invalid `plugins.settings.connector` section, makes `connector-azure-devops` unavailable too (`plugins` lists it as `unavailable` with the reason; it registers no platform); `backlog` keeps working, and only `backlog sync` fails with `PLUGIN_SERVICE_MISSING`. Disabling only `connector-azure-devops` leaves its connections listed as unavailable (`CONNECTOR_NOT_FOUND` on use).

## Connection profiles

Connections are named profiles under `plugins.settings.connector.connections` in the workspace's `bin/config.json`. A repository can define any number of them, to different organizations and projects:

```json
{
  "plugins": {
    "settings": {
      "connector": {
        "connections": {
          "contoso": {
            "platform": "azure-devops",
            "organization": "https://dev.azure.com/contoso",
            "project": "Trailhead",
            "process": "agile",
            "iterationRoot": "Trailhead",
            "mappings": { "states": { "Review": "Resolved" } }
          },
          "fabrikam": { "platform": "azure-devops", "organization": "https://dev.azure.com/fabrikam", "project": "Delivery", "process": "scrum", "tokenEnv": "FABRIKAM_PAT", "linkProperty": "fabrikam" }
        }
      }
    }
  }
}
```

Connection ids are lowercase kebab-case; a view binds to one with the view option `connection: <id>` (see [bound views](backlog.md#bound-views-define-the-sync-set)). Every profile shares these fields; the rest belong to its platform and are validated against the platform's schema when the connection is used or listed:

| Field | Default | Meaning |
| --- | --- | --- |
| `platform` | required | The connector platform, for example `azure-devops` |
| `tokenEnv` | the platform's (`AZURE_DEVOPS_EXT_PAT`) | The environment variable that holds the access token: `PAT`, `TOKEN` or a name ending in `_PAT` or `_TOKEN`, so a profile cannot pick an unrelated secret such as `AWS_SECRET_ACCESS_KEY`. Forge sends that variable's value to the profile's organization, so treat both as trusted configuration (see below) |
| `linkProperty` | the platform's (`azure-devops`) | The frontmatter key that holds the remote item's URL. Give each connection its own key when one note can sync on several connections |
| `effortProperty` | `effort` | The frontmatter key of the effort or story points (a number) |
| `areaProperty` | `area` | The frontmatter key of the area path; a note without it is in the connection's default area |
| `mappings.types` | process defaults | Local backlog type → remote work item type |
| `mappings.states` | process defaults | Local state → remote state; a `Type:State` key applies to one local type |
| `mappings.fields` | process defaults | Neutral field → remote field reference; `""` stops syncing that field |
| `mappings.properties` | none | Extra frontmatter key → remote field reference, synced as a plain value |

Shared fields are validated when the configuration loads (`INVALID_CONFIG`); platform fields when the connection is used (`CONNECTION_INVALID` with `details.issues`). Secrets are never stored in configuration or notes: the token is read from the variable only when a request needs it, sent only in the request's `Authorization` header and removed from every error message.

Connection profiles are trusted configuration: whoever can edit `bin/config.json` decides which environment variable is read and which host receives it. So a connector sends a token only to the hosts its platform expects. For Azure DevOps these are `dev.azure.com`, `*.visualstudio.com` and loopback (`localhost`, `127.0.0.1`, `[::1]`). Any other organization host, such as an Azure DevOps Server, must be listed in the environment variable `FORGE_CONNECTOR_ALLOWED_HOSTS` (comma-separated host names, case-insensitive) of the user who runs Forge, outside the shared configuration. Until then `connectors test`, `backlog sync` and every other request fail with `CONNECTION_INVALID` (`details.host`, `details.issues`) before any request is sent, and `connectors list` warns about the host (`warnings`). Still review `tokenEnv` and `organization` in shared or downloaded configuration before running a sync.

## The `connectors` command

`connectors` runs at workspace scope and never writes files.

| Action | Result |
| --- | --- |
| `connectors list` (default) | `{platforms, connections}`: each connection with its platform, `valid`, `issues`, `available` (an enabled connector exists), `tokenEnv`, `tokenSet` (the variable is set; never its value), `linkProperty`, `effortProperty`, `areaProperty`, the platform summary (organization, project, process) and `warnings` (for example an organization host the platform does not expect) |
| `connectors inspect <id>` | `{connection, platform, mapping}`: the profile and the resolved type, state, field and property mappings |
| `connectors test <id>` | `{connection, platform, ok, target}`: an authenticated, read-only probe of the remote project. Safe in dry runs |

## Events

The `connector` plugin owns these events; the backlog sync engine reports through the hub after its vault batch commits, and dry runs and `backlog sync status` publish none.

| Event | Payload |
| --- | --- |
| `connector.pushed` | `{connection, platform, path, remoteId, url, operation: "create"\|"update", fields}` |
| `connector.pulled` | `{connection, platform, path, remoteId, url, fields}` |
| `connector.conflict` | `{connection, platform, path, remoteId, url, fields}` |

## The connector contract

A connector implements `BacklogConnector` (exported as a type from the SDK, with the neutral data types) and registers itself with the `connector.hub` service when it loads:

```ts
interface BacklogConnector {
  readonly id: string;                                      // the platform, e.g. "azure-devops"
  describe(language?: Language): ConnectorDescription;      // name, profile JSON Schema, defaults, secret-free summary, warnings
  mapping(connection: Connection): ConnectorMapping;        // process defaults merged with the profile's mappings
  link(connection: Connection, id: string): string;         // the item's web URL
  idFromLink(connection: Connection, url: string): string | null; // null for another connection's URL
  test(connection: Connection): Promise<ProbeResult>;       // authenticated, read-only
  query(connection: Connection, ids: readonly string[]): Promise<RemoteItem[]>; // unreadable ids are left out
  create(connection: Connection, item: RemoteDraft): Promise<RemoteItem>;       // never retried; always returns a created item
  update(connection: Connection, id: string, patch: RemotePatch, expectedRev: string): Promise<RemoteItem>;
}
```

- `describe(language)` receives the response language (`'en'` when omitted). The `description` and the texts `warnings(connection)` returns must read in that language; `connectors list` and `connectors inspect` show them as returned. The platform `name`, ids and profile values stay as written.
- `RemoteItem` is `{id, rev, url, type, title, state, parentId?, dependencies?, iteration?, area?, priority?, effort?, tags, description?, descriptionMarkdown?, fields}` in the remote vocabulary. `area` is null in the connection's default area. `description` is the remote text exactly as read, Markdown or HTML (absent when the field is not mapped); `descriptionMarkdown` is true only when the platform declared the text as Markdown on that read. `dependencies` lists the remote ids of the item's predecessors (absent when the connection does not map dependencies); in a `RemoteDraft` or `RemotePatch` it is the complete new set, so links to other ids are removed; `fields` holds `mappings.properties` values by remote field reference.
- `RemoteDraft` and `RemotePatch` carry the same neutral fields (`parentId`, `dependencies`, …); `null` clears a field (an iteration or area falls back to the connection's default).
- `create` returns the item as stored, so the sync engine takes defaults and rules the platform applied from it. A platform that creates items in an initial state follows up with an update to the drafted state; if that fails, `create` still returns the created item rather than failing, so its id is never lost.
- `update` must apply the patch only while the item is still at `expectedRev` and otherwise fail with `details.reason: "stale-revision"`. When it cannot confirm that its link changes landed as planned (links changed on the other end without a new revision), it fails with `details.reason: "relations-changed"` although the patch was applied; the backlog then treats the item's `parent` and `dependencies` as unconfirmed.
- Errors carry the codes `CONNECTOR_AUTH_FAILED` (with `details.tokenEnv`) and `CONNECTOR_REQUEST_FAILED` (with `details.status`) and never the token. A connector refuses a host its platform does not expect, unless the user allow-listed it, with `CONNECTION_INVALID` before reading the token.
- Core connectors use the kernel `HttpClient` port: global `fetch` with a per-attempt timeout (30 s) and up to three retries of 429 and 503 responses, waiting for `Retry-After` (seconds or an HTTP date, capped at 60 s) or backing off from one second. Only repeatable requests are retried: `GET`, and requests the connector marks `retry: true` (a read-only `POST` or a `PATCH` guarded by the item's revision); a create is never retried, so throttling cannot create a duplicate. Redirects are not followed, so the token only reaches the configured host.

The neutral fields are `title`, `type`, `state`, `parent`, `dependencies`, `iteration`, `area`, `priority`, `effort`, `tags` and `description`, plus `property:<key>` for mapped properties. How the backlog compares and writes them is described in [sync](backlog.md#fields-and-the-three-way-comparison).

## Errors

| Code | When |
| --- | --- |
| `CONNECTOR_NOT_FOUND` | No such connection, or no enabled connector for its platform |
| `CONNECTION_INVALID` | The profile fails its platform schema or names unknown mapping fields |
| `CONNECTOR_AUTH_FAILED` | The token variable is unset or the service refused the token |
| `CONNECTOR_REQUEST_FAILED` | A request failed; `details.reason: "stale-revision"` marks a revision guard, `"relations-changed"` an applied update whose link changes could not be confirmed |
| `SYNC_CONFLICT` | (backlog) A remote item changed while a sync or resolution wrote it |

See the [error catalog](errors.md#core-plugin-codes) for exit statuses and hints.
