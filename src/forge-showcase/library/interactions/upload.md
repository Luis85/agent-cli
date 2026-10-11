---
schemaVersion: 1
id: upload
event: submit
preventDefault: true
actions:
  - type: upload-form
    url: "{{uploadUrl}}"
---
# Upload form

Attach to a form submit and declare a required string uploadUrl component prop pointing to your endpoint. POSTs FormData including file bytes; no endpoint is invented. Listen for forge:upload or forge:interaction-error.
