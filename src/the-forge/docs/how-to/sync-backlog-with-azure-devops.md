# Sync a backlog with Azure DevOps

[Documentation](../index.md) · How-to guide

Use this guide to keep the notes of a [product backlog](manage-backlog.md) and the work items of an Azure DevOps Boards project in sync in both directions. Fields changed on one side flow to the other; fields changed on both sides are reported as conflicts and stay untouched until you resolve them. Exact contracts are in the [backlog sync reference](../reference/backlog.md#sync-with-external-trackers), the [connectors reference](../reference/connectors.md) and the [Azure DevOps connector reference](../reference/connector-azure-devops.md).

## 1. Provide a token

Create a personal access token with **Work Items (Read & write)** scope in Azure DevOps and export it in the shell that runs Forge. Never put it in configuration or notes. Forge sends the variable named by the profile's `tokenEnv` to the profile's organization, so review both when you take over someone else's configuration:

```sh
export AZURE_DEVOPS_EXT_PAT='<your token>'
```

## 2. Add a connection profile

Add the connection to the workspace's `bin/config.json`. `iterationRoot` lets Iteration notes map to sprints; `process` selects the type and state defaults; `areaPath` is the area of notes without an `area` property:

```json
{
  "plugins": {
    "settings": {
      "connector": {
        "connections": {
          "contoso": { "platform": "azure-devops", "organization": "https://dev.azure.com/contoso", "project": "Trailhead", "process": "agile", "iterationRoot": "Trailhead" }
        }
      }
    }
  }
}
```

Check it, then probe the project with the token:

```sh
node bin/forge.js connectors list
node bin/forge.js connectors inspect contoso
node bin/forge.js connectors test contoso
```

`list` shows `valid`, `tokenSet` and `warnings` (for example an organization host that is not Azure DevOps Services); `inspect` shows the resolved type and state mappings. Adjust `mappings.states` when your backlog uses other state names than the defaults.

## 3. Bind a view

Add `connection: contoso` to the `product-backlog` view whose items should sync, or add a second view with its own filter for just those items. Several bound views can sync different item sets to different connections:

```yaml
  - type: product-backlog
    name: Contoso sync
    filters:
      and:
        - file.inFolder("docs/backlog/requirements")
    stateProperty: note.status
    priorityProperty: note.priority
    iterationProperty: note.iteration
    connection: contoso
```

## 4. Preview and push

```sh
node bin/forge.js backlog sync --dry-run
node bin/forge.js backlog sync
```

The dry run reads Azure DevOps but writes nothing; it lists the work items it would create, parents first. The real run creates them with their parent links, writes each note's `azure-devops` link property (open it in Obsidian to jump to the work item) and records the sync state in `.forge/sync/contoso.json`. Values Azure DevOps fills in on its own, such as the initial state `New` or a default priority, are pulled into the notes in the same run.

Commit `.forge/sync/contoso.json` with the notes so every clone shares the sync base. Without it (a fresh clone, a deleted file), Forge relinks notes by their link property, and with no base it cannot tell which side changed: every field that differs between a note and its work item is reported as a conflict, and nothing is overwritten on either side. Resolve those conflicts once with `backlog sync resolve`; from then on the sync has a base again. Do not copy a note together with its link property: the copy is skipped as `duplicate-link` and never takes over the original's work item.

The note body becomes the work item's description, including embeds and wikilinks; Obsidian `%%comments%%` stay private and are never sent. Azure DevOps does not say on reads whether a description is Markdown, so a description edited in Azure DevOps is usually not pulled: the sync skips it (`remote-format-unknown`) and keeps the work item's text safe until you settle it with `backlog sync resolve <item> --take local|remote --field description`.

## 5. Keep in sync

Run `backlog sync` whenever you want both sides aligned; `backlog sync status` shows what would change without writing. Use `--direction push` or `--direction pull` to sync one way only, and `--view` to sync one view. Only one sync of a connection runs at a time: a second one fails with `WORKSPACE_BUSY` naming `.forge/sync/contoso.lock`. Read `skipped` in the result: every entry has a `code` that says why a note or field was left alone.

When the same field changed in the note and in Azure DevOps, the sync reports it under `conflicts` with both values and leaves both sides alone. Settle it:

```sh
node bin/forge.js backlog sync status
node bin/forge.js backlog sync resolve "Draft a trip" --take remote
node bin/forge.js backlog sync resolve "Draft a trip" --take local --field state
```

Rename and move notes with `move` or `rename` so links and the sync state follow. A note that no bound view of its connection returns any more is reported under `left` and is never deleted in Azure DevOps; remove or close its work item there yourself. If a sync stops part-way (for example because the token expired), run it again after fixing the cause: work items it already created are recorded and are not created twice.
