---
schemaVersion: 1
id: capture-email
event: input
actions:
  - type: set-state
    state: email
    fromEvent: value
---
Keep the component's email state synchronized with the text input. The browser
supplies a string; the definition does not coerce or evaluate JavaScript.
