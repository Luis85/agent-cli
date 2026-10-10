---
schemaVersion: 1
id: time
props:
  datetime:
    type: string
    default: 2026-01-01
  label:
    type: string
    default: Date
root:
  tag: time
  attrs:
    datetime: "{{datetime}}"
  text: "{{label}}"
---
# time

Semantic time boilerplate. Supply child content and application behavior in your project.
