---
schemaVersion: 1
id: purchase-requests
kind: rest
model:
  name: PurchaseRequestView
  idField: id
  fields:
    id:
      type: string
    title:
      type: string
    purpose:
      type: string
    amountMinor:
      type: number
    currency:
      type: string
      enum: [EUR]
    status:
      type: string
      enum: [pending, approved, rejected]
    requesterId:
      type: string
    approverId:
      type: string
    revision:
      type: number
    submittedAt:
      type: string
rest:
  baseUrl: https://api.example.test/api
  operations:
    get:
      method: GET
      path: /requests/{id}
testData:
  records:
    - id: req_demo_17
      title: Conference workshop
      purpose: Attend a workshop needed for the customer research pilot.
      amountMinor: 24000
      currency: EUR
      status: pending
      requesterId: person_demo_morgan
      approverId: person_demo_pat
      revision: 7
      submittedAt: '2026-10-06T09:30:00Z'
---
Synthetic read-model contract for REQ-02 and UI-02. The example.test URL is a
placeholder; code generation never contacts it. Inject the actual runtime URL
and authenticated fetch implementation in the consuming application.

This definition generates only a get operation. Purchase submission and decision
commands require application-specific payloads, authorization, revision handling
and idempotency; they are deliberately not modeled as generic CRUD updates.
Scalar transport validation does not enforce integer amounts, revision bounds,
organization access or domain transitions. Apply those invariants in the service.
