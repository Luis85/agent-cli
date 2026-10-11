import { libraries } from './project.mjs';

export const dataOutputs = { adapters: 'src/infrastructure/data-sources', fixtures: 'test-data' };

const sources = {
  'trips-api': { kind: 'rest', content: `---
schemaVersion: 1
id: trips-api
kind: rest
model:
  name: TripRecord
  idField: id
  fields:
    id:
      type: string
    title:
      type: string
    destination:
      type: string
    nights:
      type: number
    status:
      type: string
      enum: [planned, booked, completed]
    favorite:
      type: boolean
    notes:
      type: string
      optional: true
      nullable: true
rest:
  baseUrl: https://api.trailhead.example/v1
  operations:
    list:
      method: GET
      path: /trips
      responsePath: data.items
    get:
      method: GET
      path: /trips/{id}
    create:
      method: POST
      path: /trips
    update:
      method: PATCH
      path: /trips/{id}
    delete:
      method: DELETE
      path: /trips/{id}
testData:
  records:
    - id: trip-lakeside
      title: Lakeside weekend
      destination: Lake Tahoe
      nights: 2
      status: planned
      favorite: true
      notes: Bring the canoe.
    - id: trip-coastal
      title: Coastal traverse
      destination: Big Sur
      nights: 4
      status: booked
      favorite: false
    - id: trip-ridge
      title: Ridge loop
      destination: Mount Rainier
      nights: 3
      status: completed
      favorite: false
      notes: null
---
# Trips API

The Trailhead REST API that stores a hiker's trips. It backs [[UC-001 Plan a trip]] and [[UC-002 Share an itinerary]] and is rendered by [[trip-card]]. The base URL uses the reserved \`.example\` domain: the generated adapter is a typed contract, and the showcase never contacts a server. Tests inject \`fetch\` and serve the deterministic fixtures instead.
` },
  'trail-guides': { kind: 'json', content: `---
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

A bundled, read-only JSON catalogue of trail guides used while offline ([[UC-003 Browse trail guides]], REQ-002). Its \`json.path\` points at the generated fixture so the deterministic test data doubles as the local dataset.
` },
};

/**
 * Data-source definitions, typed adapters and deterministic fixtures.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
export function buildDataSources(cli) {
  cli.begin('Data sources');
  const library = ['--library', libraries.dataSources];
  for (const [id, source] of Object.entries(sources)) {
    cli.run(['data-sources', 'create', id, '--kind', source.kind, ...library]);
    cli.replace(`library/data-sources/${id}.md`, source.content);
  }
  cli.run(['data-sources', 'validate', ...library]);
  cli.run(['data-sources', 'list', ...library]);
  for (const id of Object.keys(sources)) {
    const output = ['--out', dataOutputs.adapters, '--test-data-out', dataOutputs.fixtures];
    cli.run(['make', 'data-source', id, ...library, ...output]);
    cli.run(['make', 'data-source', id, ...library, ...output, '--check']);
  }
}
