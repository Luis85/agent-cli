---
schemaVersion: 1
id: save-trip-draft
event: submit
preventDefault: true
actions:
  - type: save-form
    key: trailhead-trip-draft
  - type: emit
    event: trip:draft-saved
---
# Save trip draft

Stores the trip request form in this browser under `trailhead-trip-draft` and notifies the application. Requirement REQ-001; see [[Trip planner design]].
