---
schemaVersion: 1
id: toggle-favorite
event: click
actions:
  - type: toggle-state
    state: favorite
  - type: emit
    event: trip:favorite-changed
    detail:
      favorite: "{{state.favorite}}"
---
# Toggle favourite

Marks a trip as a favourite and emits `trip:favorite-changed` so the application can persist it through the [[trips-api]] data source. Requirement REQ-003; see [[Trip planner design]].
