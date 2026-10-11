---
schemaVersion: 1
id: download
event: click
preventDefault: true
actions:
  - type: download-form
    filename: form-data.json
---
# Download form JSON

Attach to a button associated with a form. Downloads named fields as form-data.json; repeated names become arrays and file fields include metadata only. Listen for forge:download or forge:interaction-error.
