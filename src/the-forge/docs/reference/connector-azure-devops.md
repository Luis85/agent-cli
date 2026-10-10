# Azure DevOps connector

[Documentation](../index.md) · Reference

The `connector-azure-devops` core plugin syncs backlog notes with Azure DevOps Boards work items through the Work Items REST API, api-version 7.1. It implements the [connector contract](connectors.md#the-connector-contract) and is used by [`backlog sync`](backlog.md#sync-with-external-trackers). Azure DevOps Services (`https://dev.azure.com/<organization>`) is the primary target; Azure DevOps Server works with `descriptionFormat: html`.

## Profile

A connection with `platform: "azure-devops"` takes the [shared fields](connectors.md#connection-profiles) and these:

| Field | Default | Meaning |
| --- | --- | --- |
| `organization` | required | The organization URL, such as `https://dev.azure.com/contoso` or a server collection URL. `https` only; `http` is accepted for `localhost` and loopback addresses (test servers) |
| `project` | required | The project name |
| `areaPath` | none | The area path of created items and the scope of change queries |
| `iterationRoot` | none | The iteration path under which Iteration notes map by name, such as `Trailhead` or `Trailhead\Sprints`. Without it, iterations do not sync |
| `process` | `agile` | `agile`, `scrum`, `basic` or `custom`: the type, state and field defaults below. `custom` starts empty; map types and states yourself |
| `descriptionFormat` | `markdown` | How the note body syncs with `System.Description`; see [descriptions](#descriptions) |

Unknown fields are `CONNECTION_INVALID`.

## Authentication

The connector authenticates with a personal access token (PAT) read from the variable named by `tokenEnv` (default `AZURE_DEVOPS_EXT_PAT`, the variable the Azure CLI DevOps extension uses). It sends `Authorization: Basic base64(":" + token)` on every request. The PAT needs **Work Items (Read & write)**; `connectors test` needs project read access. A missing variable, a 401 or 403, the 203 sign-in page Azure DevOps returns for an invalid PAT, or a redirect is `CONNECTOR_AUTH_FAILED`. The token never appears in results, events or errors. Entra ID and `az` CLI tokens are not supported yet.

## Requests

| Purpose | Request |
| --- | --- |
| `connectors test` | `GET {organization}/_apis/projects/{project}?includeCapabilities=true`: project id, state and process name (`processMatches` compares it with `process`) |
| Linked items | `POST {organization}/{project}/_apis/wit/workitemsbatch` with `$expand: relations`, 200 ids per request |
| Items changed since a time | `POST …/_apis/wit/wiql?timePrecision=true` with `[System.ChangedDate] >= '<time>'` (and `[System.AreaPath] UNDER '<areaPath>'`), then the batch read |
| Create | `POST …/_apis/wit/workitems/${type}` with a JSON Patch document (`application/json-patch+json`): fields, area path, `multilineFieldsFormat` and the parent relation |
| Update | `PATCH …/_apis/wit/workitems/{id}`: first `{"op": "test", "path": "/rev", "value": <expected>}`, then the field operations. A parent change reads the item's relations and replaces the parent relation by index. A failed revision test (HTTP 412, `TF26071`) is reported as `stale-revision` |

Throttled requests (429, 503) are retried with `Retry-After`; see [transport](connectors.md#the-connector-contract).

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
| `iteration` | `System.IterationPath`; an item without an iteration is set to the project root |
| `priority` | `Microsoft.VSTS.Common.Priority` (1–4) |
| `effort` | `Microsoft.VSTS.Scheduling.StoryPoints` (Agile), `Microsoft.VSTS.Scheduling.Effort` (Scrum, Basic, custom) |
| `tags` | `System.Tags` (`a; b`) |
| `description` | `System.Description` |

Created items get `areaPath` as `System.AreaPath`. Predecessor links (`System.LinkTypes.Dependency-Reverse`) are read into `links.predecessors`; `dependsOn` lists do not sync yet. Override any default per connection:

```json
{ "mappings": { "types": { "PBI": "Requirement" }, "states": { "Review": "Resolved", "Task:Review": "Active" }, "fields": { "effort": "Microsoft.VSTS.Scheduling.Size", "description": "" }, "properties": { "risk": "Microsoft.VSTS.Common.Risk" } } }
```

## Descriptions

Azure DevOps stores large text fields as HTML, and since 2025 Azure DevOps Services can store them as Markdown per work item (`multilineFieldsFormat`). The connector uses that:

- `markdown` (default): the note body is sent unchanged with `{"op": "add", "path": "/multilineFieldsFormat/System.Description", "value": "Markdown"}`, and Markdown descriptions read back unchanged, so descriptions sync both ways losslessly. Azure DevOps converts a work item to Markdown permanently once it is saved this way. A description still stored as HTML (edited in the classic editor) is not pulled: it is treated as unchanged remotely until the note's body is pushed.
- `html`: for Azure DevOps Server and HTML-only workflows. The body is converted with a minimal, safe converter (headings, paragraphs, line breaks, lists, block quotes, code, bold, italics, http(s)/mailto links; every other character is escaped, wikilinks become their text) and pushed. Remote HTML is never pulled back, so descriptions are push-only.

## Limitations

- Only items that a bound view returns sync; remote items without a note are not imported.
- Dependencies (`dependsOn` ↔ predecessor links), assignees, dates, comments and attachments do not sync yet.
- An iteration syncs only when an Iteration note with the iteration path's last segment exists locally.
- Changing a work item's type follows Azure DevOps' rules for the process; a rejected change fails that note only.
