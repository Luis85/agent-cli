---
schemaVersion: 1
id: link
props:
  href:
    type: string
    default: "#"
  label:
    type: string
    default: Link
root:
  tag: a
  attrs:
    href: "{{href}}"
  text: "{{label}}"
---
# link

Semantic a boilerplate. Supply child content and application behavior in your project.
