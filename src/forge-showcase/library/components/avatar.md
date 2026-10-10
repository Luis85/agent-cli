---
schemaVersion: 1
id: avatar
props:
  src:
    type: string
    default: avatar.png
  alt:
    type: string
    default: Profile picture
root:
  tag: img
  attrs:
    src: "{{src}}"
    alt: "{{alt}}"
    class: avatar
---
# avatar

Semantic img boilerplate. Supply child content and application behavior in your project.
