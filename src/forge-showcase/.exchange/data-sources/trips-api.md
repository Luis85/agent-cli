---
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

The Trailhead REST API that stores a hiker's trips. It backs [[UC-001 Plan a trip]] and [[UC-002 Share an itinerary]] and is rendered by [[trip-card]]. The base URL uses the reserved `.example` domain: the generated adapter is a typed contract, and the showcase never contacts a server. Tests inject `fetch` and serve the deterministic fixtures instead.
