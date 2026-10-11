---
schemaVersion: 1
id: capture-destination
event: input
actions:
  - type: set-state
    state: destination
    fromEvent: value
---
# Capture destination

Copies the destination field into the planner's `destination` state while the hiker types. Requirement REQ-001; see [[UC-001 Plan a trip]] and [[Trip planner design]].
