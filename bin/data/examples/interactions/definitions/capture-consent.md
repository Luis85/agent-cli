---
schemaVersion: 1
id: capture-consent
event: change
actions:
  - type: set-state
    state: consent
    fromEvent: checked
---
Copy the checkbox's checked state into the component's boolean consent state.
