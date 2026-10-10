---
schemaVersion: 1
id: meter
props:
  value:
    type: number
    default: 0
  max:
    type: number
    default: 100
root:
  tag: meter
  attrs:
    value: "{{value}}"
    max: "{{max}}"
    aria-label: Measurement
---
# meter

Semantic meter boilerplate. Supply child content and application behavior in your project.
