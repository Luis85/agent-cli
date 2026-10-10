---
schemaVersion: 1
id: radio
props:
  name:
    type: string
    default: choice
  value:
    type: string
    default: option
  checked:
    type: boolean
    default: false
root:
  tag: input
  attrs:
    type: radio
    name: "{{name}}"
    value: "{{value}}"
    checked: "{{checked}}"
---
# radio

Semantic input boilerplate. Supply child content and application behavior in your project.
