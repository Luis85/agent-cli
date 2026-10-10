---
schemaVersion: 1
id: image
props:
  src:
    type: string
    default: image.png
  alt:
    type: string
    default: ""
root:
  tag: img
  attrs:
    src: "{{src}}"
    alt: "{{alt}}"
---
# image

Semantic img boilerplate. Supply child content and application behavior in your project.
