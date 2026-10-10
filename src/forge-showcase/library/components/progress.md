---
schemaVersion: 1
id: progress
props:
  value:
    type: number
    default: 0
  max:
    type: number
    default: 100
root:
  tag: progress
  attrs:
    value: "{{value}}"
    max: "{{max}}"
    aria-label: Progress
---
# progress

Semantic progress boilerplate. Supply child content and application behavior in your project.
