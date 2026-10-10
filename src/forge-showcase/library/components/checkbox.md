---
schemaVersion: 1
id: checkbox
props:
  name:
    type: string
    default: choice
  checked:
    type: boolean
    default: false
root:
  tag: input
  attrs:
    type: checkbox
    name: "{{name}}"
    checked: "{{checked}}"
---
# checkbox

Semantic input boilerplate. Supply child content and application behavior in your project.
