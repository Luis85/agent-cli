---
schemaVersion: 1
id: prepare-request
event: submit
preventDefault: true
actions:
  - type: set-state
    state: status
    value: Request prepared
  - type: emit
    event: contact:requested
    detail:
      email: "{{state.email}}"
      consent: "{{state.consent}}"
      status: "{{state.status}}"
---
Prepare a contact request and notify the application. Actions run in order, so
the event receives the updated status. This does not send a network request or
claim that a server has accepted the request.
