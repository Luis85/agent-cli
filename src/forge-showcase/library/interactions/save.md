---
schemaVersion: 1
id: save
event: submit
preventDefault: true
actions:
  - type: save-form
    key: forge-form
---
# Save form locally

Attach to a form submit. Stores named fields as JSON in this browser origin's localStorage under forge-form. Change key to namespace drafts. File fields store metadata, not file contents. Listen for forge:save or forge:interaction-error.
