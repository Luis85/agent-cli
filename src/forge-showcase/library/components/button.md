---
schemaVersion: 1
id: button
props:
  label:
    type: string
    default: Button
  disabled:
    type: boolean
    default: false
root:
  tag: button
  attrs:
    type: button
    disabled: "{{disabled}}"
  text: "{{label}}"
---
# button

Semantic button boilerplate. Supply child content and application behavior in your project.
