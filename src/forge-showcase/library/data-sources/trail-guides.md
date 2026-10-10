---
schemaVersion: 1
id: trail-guides
kind: json
model:
  name: TrailGuide
  fields:
    id:
      type: string
    name:
      type: string
    region:
      type: string
      enum: [sierra, cascades, coast, desert]
    distanceKm:
      type: number
    difficulty:
      type: string
      enum: [easy, moderate, hard]
    dogFriendly:
      type: boolean
json:
  path: test-data/trail-guides.fixtures.json
testData:
  records:
    - id: guide-desolation
      name: Desolation Wilderness traverse
      region: sierra
      distanceKm: 32
      difficulty: hard
      dogFriendly: false
    - id: guide-skyline
      name: Skyline Trail
      region: cascades
      distanceKm: 9
      difficulty: moderate
      dogFriendly: false
    - id: guide-pfeiffer
      name: Pfeiffer Falls
      region: coast
      distanceKm: 3
      difficulty: easy
      dogFriendly: true
    - id: guide-joshua
      name: Ryan Mountain
      region: desert
      distanceKm: 5
      difficulty: moderate
      dogFriendly: false
---
# Trail guides

A bundled, read-only JSON catalogue of trail guides used while offline ([[UC-003 Browse trail guides]], REQ-002). Its `json.path` points at the generated fixture so the deterministic test data doubles as the local dataset.
