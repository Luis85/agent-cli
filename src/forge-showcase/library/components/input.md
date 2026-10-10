---
schemaVersion: 1
id: input
props:
  name:
    type: string
    default: field
  value:
    type: string
    default: ""
root:
  tag: input
  attrs:
    type: text
    name: "{{name}}"
    value: "{{value}}"
---
# input

Semantic input boilerplate. Supply child content and application behavior in your project.
