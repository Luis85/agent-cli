---
id: PLAN-001
status: proposed
specification: SPEC-001
---
# Delivery plan: small, verifiable slices

Each slice ends in a reviewable diff and evidence mapped to requirement IDs. “Done” means its acceptance examples were executed successfully in the target application, its affected docs are accurate and open findings are recorded. None of the slices below has been implemented by this example.

| Slice | Deliverable and dependency | Acceptance evidence |
| --- | --- | --- |
| S-01 | Agree discovery result, scope, roles, retention and target stack; no predecessor | Record actual OP-001 evidence and decisions; link PRD owners and unresolved questions. No production work commitment until those decisions are made. |
| S-02 | Pending request submission through browser/API/database; depends S-01 | T-01 valid submit, invalid amount/text/approver cases, retry without duplicate, organization checks, one real persistence integration test |
| S-03 | Authorized list/detail, generated presentation, REST read adapter and local fixture loader; depends S-02 | T-03 unauthorized read isolation; adapter tests for malformed responses, 404/network errors and missing local files; T-07 loading/empty/error/narrow viewport stories; inspect generated diff |
| S-04 | Approval/rejection transaction, audit history and idempotency; depends S-03 | T-02 transitions/reason limits; T-04 real concurrent writes; T-05 lost-response retry and changed-key-payload conflict |
| S-05 | Accessible end-to-end decision journeys and operational instrumentation; depends S-04 | T-06 keyboard/screen-reader journey; T-07 network/stale failure recovery; logs omit sensitive text; one real browser flow per decision path |
| S-06 | Staging validation, rollback/restore rehearsal and limited pilot; depends S-05 | T-08 load budget, REL-01–05 evidence, actual provider command reviewed and executed only with deployment authorization |

## Acceptance/test traceability

| Test | Requirements | Test boundary and decisive assertion |
| --- | --- | --- |
| T-01 | REQ-01 | Unit limits plus API/persistence integration: exact bounds 1/500000 cents accepted, 0/500001 rejected; invalid writes persist nothing; same submission key creates one request |
| T-02 | REQ-02, REQ-05 | Domain transition tests and repository integration: rejection reason bounds, one durable decision/audit record, requester sees saved result |
| T-03 | REQ-03 | HTTP/identity integration: requester, assignee, finance, unrelated member and other organization; deny unauthorized reads/writes without data leakage |
| T-04 | REQ-04, REQ-05 | Real database concurrency: two clients start from same revision, exactly one terminal change and audit event; inject failure between writes and verify rollback |
| T-05 | REQ-04 | Integration: replay same key/payload after committed response loss, original outcome returned; changed payload rejected; verify actor/resource key scope |
| T-06 | REQ-06 | Automated accessibility scan plus manual keyboard/screen-reader review of submission, approval, rejection and errors; record actual browser/tool versions and findings |
| T-07 | REQ-07 | Component interactions and browser test: slow load, empty list, 401/404, 409, dropped response, narrow layout, long text; drafts/focus preserved appropriately |
| T-08 | REQ-08 | Staging load, backup restore and rollback rehearsal; record fixture size, environment, workload and result against approved budget |

## Working agreement for agents and reviewers

Assign each agent a slice or disjoint files and an acceptance contract. One coordinator owns shared project selection and integration. Use `make ui --project <id>` for explicit output scope; a persisted `project open` affects other invocations in that workspace. Avoid concurrent regeneration into the same destinations.

Before a slice: read `AGENTS.md`, relevant requirements and actual package scripts; preview scaffold changes. After edits: run the affected tests, `npm run check:fast`, then the target project's full `npm run check`. If adding a framework changes required compilation or browser tests, wire them into the project's real checks. Repo/CLI checks alone do not prove this product works.

For generated output already present, generate into a review directory or use reviewed revision-map regeneration as documented in the component guide. Never overwrite hand edits by manufacturing current hashes without inspecting the files. Review business behavior and integration separately from byte determinism.

Evidence entry template: `Test ID | commit | command or manual procedure | environment | outcome | evidence link | reviewer | remaining finding`. Keep unsuccessful results as well as the eventual correction. Do not claim a test passed because a file with a matching name exists.
