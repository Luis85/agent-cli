---
id: UC-01
status: proposed
requirements: [REQ-02, REQ-03, REQ-04, REQ-05, REQ-06, REQ-07]
---
# Use case: decide a pending purchase request

**Goal:** a designated manager records an authorized, understandable and durable decision.

**Primary actor:** assigned manager. **Other actors:** requester, finance reviewer, identity provider and audit storage. **Trigger:** manager opens a request from the application request list. **Preconditions:** manager has an authenticated organization session; request exists in that organization and is assigned to them. Being able to see a page is not proof that a later write is authorized.

**Success postcondition:** one approved or rejected decision is committed with its audit event; all authorized readers observe the same state. **Failure guarantee:** rejected/failed writes do not alter the request or append misleading success events; uncertain network outcomes are reconciled through the idempotent API.

## Main flow: approve

1. Manager opens request `req_demo_17`. Server authorizes the read and returns pending revision `7`; UI-02 displays requester Morgan Lee, “Conference workshop”, €240.00 and purpose.
2. Manager selects **Approve**. UI-03 shows a confirmation containing the purchase title and amount; its cancel action returns to the detail view.
3. Manager confirms. Client sends `approve`, expected revision `7` and one new idempotency key; UI-04 announces “Saving decision” and prevents duplicate local submission.
4. Server rechecks actor/organization/assignment, pending status and revision, then commits the decision and audit record in one transaction.
5. UI-05 displays “Approved”, actor and recorded time; focus moves to the decision result heading and a polite live region announces success. Decision buttons are removed. The requester sees the committed status on their next refresh.

## Alternative and error flows

| Flow | At step | Behavior and resulting state |
| --- | --- | --- |
| A1: reject | 2 | Show an inline rejection form (UI-06); require a reason before confirmation. Follow steps 3–5 with `reject`; render the saved reason as text. |
| A2: cancel | 2–3 | Restore the original detail controls and focus. No API write or audit event. Retain typed reason only in local page state while the page remains open. |
| E1: reason empty/too long | A1 | UI-07 exposes summary and associated field error; retain entered text, focus summary, submit nothing. Server independently rejects invalid payloads. |
| E2: other session already decided | 4 | Return conflict; UI-08 fetches current state, explains who decided and when, and offers copying any unsaved reason. Never overwrite or automatically resubmit. |
| E3: response lost after commit | 4–5 | UI-09 says confirmation is unavailable. Retry with the same key and unchanged payload, or reload current state. Do not report that the decision failed when its outcome is unknown. |
| E4: session expired | Any server call | Reauthenticate via the approved identity flow; no silent write retry after reauthentication. Re-fetch authorization/state before offering action. Do not persist sensitive draft text in a URL. |
| E5: forbidden, unknown or cross-organization ID | 1 or 4 | Use the same non-disclosing not-found response. UI-10 links to request list. No request content, actor identity or amount is exposed. |
| E6: storage failure before commit | 4 | Roll back both writes; return a retryable service error with a request ID. UI-09 preserves draft; bounded retry uses the original key. Logs contain technical IDs, not rejection/purpose text. |

## Acceptance examples

- **T-02:** given a pending request assigned to Pat, when Pat approves revision 7, then it is approved at revision 8 with one audit event; a subsequent refresh returns that decision.
- **T-03:** given the same request, when its requester or a member of another organization attempts to decide it, then the server denies access and both stored request and audit history remain unchanged.
- **T-04:** given two concurrent commands against revision 7, exactly one succeeds; the other returns the current-state conflict without adding a second event.
- **T-05:** given an approval committed but its response lost, retrying its key and payload returns the original decision; reusing that key with a different payload is rejected.
- **T-06:** using keyboard only, reach both decisions, cancel confirmation, correct a missing reason and hear/observe the result without losing focus context.

The detail-page component fixtures illustrate UI-02 and UI-05 copy only. Real confirmation, authorization, form validation and failure transitions require application code and the tests above.
