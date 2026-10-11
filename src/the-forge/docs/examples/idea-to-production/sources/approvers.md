---
schemaVersion: 1
id: approvers
kind: json
model:
  name: DemoApprover
  idField: id
  fields:
    id:
      type: string
    displayName:
      type: string
    active:
      type: boolean
json:
  path: testdata/generated/approvers.fixtures.json
testData:
  records:
    - id: person_demo_pat
      displayName: Pat Quinn
      active: true
    - id: person_demo_robin
      displayName: Robin Blake
      active: false
---
Fictional local approver records for development and interaction tests.
The path matches this tutorial's generated test-data output; generation itself
does not load or write to json.path unless it is also the selected fixture path.
The caller injects a JSON loader rooted at the consuming project.

Filter inactive people in the presentation. Real approval eligibility must come
from authenticated organization membership checked on the server, never this
demo file. Do not ship this local fixture as a production authorization source.
