# Azure DevOps connector

[Documentation](../index.md) · Reference

The `connector-azure-devops` core plugin syncs backlog notes with Azure DevOps Boards work items through the Work Items REST API, api-version 7.1. It implements the [connector contract](connectors.md#the-connector-contract) and is used by [`backlog sync`](backlog.md#sync-with-external-trackers). Azure DevOps Services (`https://dev.azure.com/<organization>`) is the primary target; Azure DevOps Server works with `descriptionFormat: html`.

## Profile

A connection with `platform: "azure-devops"` takes the [shared fields](connectors.md#connection-profiles) and these:

| Field | Default | Meaning |
| --- | --- | --- |
| `organization` | required | The organization URL, such as `https://dev.azure.com/contoso` or a server collection URL. `https` only, without user info (`user@host` is `CONNECTION_INVALID`); `http` is accepted for `localhost` and loopback addresses (test servers). `connectors list` warns when the host is neither `dev.azure.com` nor `*.visualstudio.com`, since the token is sent there (expected only for Azure DevOps Server) |
| `project` | required | The project name |
| `areaPath` | the project | The default area: notes without an area property sync to it, and items in it read as having no area |
| `iterationRoot` | none | The iteration path under which Iteration notes map by name, such as `Trailhead` or `Trailhead\Sprints`. Without it, iterations do not sync |
| `process` | `agile` | `agile`, `scrum`, `basic` or `custom`: the type, state and field defaults below. `custom` starts empty; map types and states yourself |
| `descriptionFormat` | `markdown` | How the note body syncs with `System.Description`; see [descriptions](#descriptions) |

Unknown fields are `CONNECTION_INVALID`.

## Authentication

The connector authenticates with a personal access token (PAT) read from the variable named by `tokenEnv` (default `AZURE_DEVOPS_EXT_PAT`, the variable the Azure CLI DevOps extension uses). It sends `Authorization: Basic base64(":" + token)` on every request. The PAT needs **Work Items (Read & write)**; `connectors test` needs project read access. A missing variable, a 401 or 403, the 203 sign-in page Azure DevOps returns for an invalid PAT, or a redirect is `CONNECTOR_AUTH_FAILED`. The token never appears in results, events or errors. Microsoft Entra ID and `az` CLI tokens are not supported.

## Requests

| Purpose | Request |
| --- | --- |
| `connectors test` | `GET {organization}/_apis/projects/{project}?includeCapabilities=true`: project id, state and process name (`processMatches` compares it with `process`) |
| Linked items | `POST {organization}/{project}/_apis/wit/workitemsbatch` with `$expand: relations` and `errorPolicy: omit`, 200 ids per request |
| Create | `POST …/_apis/wit/workitems/${type}` with a JSON Patch document (`application/json-patch+json`): fields except the state, area path, `multilineFieldsFormat`, the parent relation and predecessor relations. Processes start work items in their initial state, so a drafted state other than the one the item was created in follows as an update; if that update fails, the item stays in its initial state and the next sync pushes the state again |
| Update | `PATCH …/_apis/wit/workitems/{id}`: first `{"op": "test", "path": "/rev", "value": <expected>}`, then the field operations. A parent or dependency change first reads the item with `$expand=relations`, then removes relations by index with `{"op": "remove", "path": "/relations/<index>"}` in descending index order (so every index still names the relation it was read as) and adds new ones with `{"op": "add", "path": "/relations/-", "value": {"rel": …, "url": "{organization}/_apis/wit/workItems/{id}"}}`. A failed revision test (HTTP 412, `TF26071`) is reported as `stale-revision`. The reference documents a `test` of `/rev` only, and a link added or removed on the item at the other end does not revise this item, so an index can name another relation by the time the PATCH applies. The connector therefore checks the relations the PATCH returns. An update that removes no relation always passes. Otherwise every relation read and not removed up to `n` positions above the highest removed index (for `n` removals, the furthest a removal can be shifted by relations that went meanwhile) and every one added must be there and every removed one gone; relations further up may have been removed on the other end (unless one of them is the same link as one read below them), and relations added meanwhile are ignored. Relations are compared by type and target: the work item id for a link to a work item, the complete URL for any other link, so two hyperlinks that end in the same number stay distinct. When the check fails, the update, although applied, fails with `CONNECTOR_REQUEST_FAILED` and `details.reason: "relations-changed"` |

Throttled reads and revision-guarded updates (429, 503) are retried with `Retry-After`; creates are never retried. See [transport](connectors.md#the-connector-contract). Failed requests carry the service's error message (`details.status`, the message in the error).

## Default mappings

Types (local backlog type → work item type; reading back, a work item type maps to the first local type listed for it):

| Local | Agile | Scrum | Basic |
| --- | --- | --- | --- |
| Epic | Epic | Epic | Epic |
| Feature | Feature | Feature | Epic |
| PBI | User Story | Product Backlog Item | Issue |
| Task | Task | Task | Task |
| Bug | Bug | Bug | Issue |
| Issue | Issue | Impediment | Issue |

Other types (Milestone, Idea, Deliverable, …) are skipped unless `mappings.types` maps them.

States (local → remote; the process's own state names map to themselves and win when a remote state is read back, and a value from the view's `stateValues` is preferred):

| Process | Mapping |
| --- | --- |
| Agile | New, Active, Resolved, Closed, Removed to themselves; Open and To Do → New; In Progress → Active; Done → Closed |
| Scrum | New, Approved, Committed, Done, Removed to themselves; Open and To Do → New; Active and In Progress → Committed; Closed → Done. Tasks: To Do, In Progress, Done, Removed to themselves; New and Open → To Do; Active → In Progress; Closed → Done |
| Basic | To Do, Doing, Done to themselves; New and Open → To Do; Active and In Progress → Doing; Closed → Done |

A state without a mapping is sent as it is; Azure DevOps rejects states its process does not know (`CONNECTOR_REQUEST_FAILED` for that note).

Fields:

| Neutral field | Remote field |
| --- | --- |
| `title` | `System.Title` |
| `type` | `System.WorkItemType` |
| `state` | `System.State` |
| `parent` | the `System.LinkTypes.Hierarchy-Reverse` relation |
| `dependencies` | the `System.LinkTypes.Dependency-Reverse` relations: the item's predecessors (Azure DevOps records the reverse `Dependency-Forward` successor link on each predecessor) |
| `iteration` | `System.IterationPath`; an item without an iteration is set to the project root |
| `area` | `System.AreaPath`; an item without an area is set to `areaPath` (else the project), and an item there reads as having none |
| `priority` | `Microsoft.VSTS.Common.Priority` (1–4) |
| `effort` | `Microsoft.VSTS.Scheduling.StoryPoints` (Agile), `Microsoft.VSTS.Scheduling.Effort` (Scrum, Basic, custom) |
| `tags` | `System.Tags` (`a; b`) |
| `description` | `System.Description` |

A field reference of `""` stops that field from syncing, such as `"dependencies": ""` to keep predecessor links out of the sync. Override any default per connection:

```json
{ "mappings": { "types": { "PBI": "Requirement" }, "states": { "Review": "Resolved", "Task:Review": "Active" }, "fields": { "effort": "Microsoft.VSTS.Scheduling.Size", "description": "" }, "properties": { "risk": "Microsoft.VSTS.Common.Risk" } } }
```

## Descriptions

Azure DevOps stores large text fields as HTML, and since 2025 Azure DevOps Services can store them as Markdown per work item: a JSON Patch operation `{"op": "add", "path": "/multilineFieldsFormat/System.Description", "value": "Markdown"}` saves the field as Markdown, and the item cannot return to HTML afterwards. The API reference does not document `multilineFieldsFormat` on reads, so the connector never depends on it: a read marks the description as Markdown (`descriptionMarkdown`) only when the response declares that format, and otherwise returns the text as it is.

- `markdown` (default): the note body is sent unchanged with the Markdown format operation. The sync compares the note body and the remote text each against its own base, so a note change is pushed only while the remote text is still the text last synced, and a remote change is pulled only when the response declares Markdown. Otherwise the remote change is skipped (`remote-format-unknown`) and turns into a conflict when the note changes too; `backlog sync resolve --field description` settles it.
- `html`: for Azure DevOps Server and HTML-only workflows. The body is converted with a minimal, safe converter (headings, paragraphs, line breaks, lists, block quotes, fenced code (also indented inside list items), inline code, bold, italics, http(s)/mailto links; every other character is escaped, wikilinks become their text) and pushed. Remote HTML is never pulled back as Markdown; a remote edit is skipped and protects the remote text from being overwritten until it is resolved.

The whole note body is pushed, including embeds and wikilinks, which Azure DevOps shows as plain text. Obsidian `%%comments%%` are removed before the push, including a comment left unclosed, which hides the rest of the note in Obsidian, so nothing after it is pushed; a `%%` inside fenced or inline code and an escaped `\%%` stay text. A pulled description keeps the note's comments, appended after it.

## Dependencies

A note's `dependsOn` list (the view's `dependsOnProperty`) syncs with the item's predecessor links, compared as a sorted set of remote ids with the same three-way rules as every other field; see [dependencies](backlog.md#dependencies). Links are written in a second phase of each view's sync, after every create of the run, so a note may depend on a note that the same run creates. Azure DevOps refuses a link that already exists and a dependency that would close a cycle (HTTP 400, reported in `failed`).

Adding or removing a link also records the reverse link on the other item. The REST reference's update history example shows such link-only changes recorded on the other item without a new revision, but that is not verified against a live organization. The sync does not depend on it: when a guarded update fails because the revision moved, the connector reads the item again, and if none of its synced values changed (only links seen from the other end) it repeats the update once at the fresh revision; any real remote change stays `SYNC_CONFLICT`.

## Limitations

- Only items that a bound view returns sync; remote items without a note are **not imported**. An import would have to select remote items by a separate remote query (WIQL `POST {organization}/{project}/_apis/wit/wiql`, then `workitemsbatch`), because a view's selection is a local Bases filter (formulas, `file.*` properties, links) with no WIQL equivalent. Each imported note would then have to satisfy the view's filter before it is written, or the next sync reports it under `left` and a rerun imports it again. The `bases.query` service evaluates the scope's existing files (and their filesystem dates), so it cannot check a note that is only planned, and writing a note to test it would break dry runs, which must show exactly what a sync writes. Imported bodies would also stay empty while reads do not declare Markdown (see below). Create the notes with `backlog add` and set their link property instead; the next sync links them.
- Authentication is by personal access token only; Microsoft Entra ID tokens (for example from `az account get-access-token`) are not supported.
- Assignees, start and target dates, comments and attachments do not sync.
- Whether reads (`GET` and `workitemsbatch`) return `multilineFieldsFormat` is not verified against a live organization, so remote description edits are pulled only when a read declares Markdown (see [descriptions](#descriptions)).
- The connector is tested against an in-process fake of the REST API that follows the documented behavior (`tests/support/azure-devops.ts`), not against a live organization.
- An iteration syncs only when an Iteration note with the iteration path's last segment exists locally.
- Changing a work item's type follows Azure DevOps' rules for the process; a rejected change fails that note only. A remote type without a local mapping is reported (`unmapped-remote-type`) and not written into the note.
