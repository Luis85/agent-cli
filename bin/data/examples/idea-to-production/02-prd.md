---
id: PRD-001
status: proposed
opportunity: OP-001
---
# PRD: Team Purchase Approvals, pilot

## Product decision and users

Build a small internal web application if discovery validates [OP-001](01-opportunity.md). An employee submits a purchase request; the assigned manager records one decision; authorized participants can inspect the history. Finance can review records within its organization. Product owner owns scope and outcome decisions, finance owns purchase policy, service owner owns operation, and engineering owns implementation evidence. Assign named people before the pilot.

Primary personas: employee/requester (occasional use, mobile or desktop), manager/approver (several decisions in a session), finance reviewer (read-only reconciliation). Membership and roles come from the organization's approved identity provider.

## Outcomes

Illustrative targets below must be revised after establishing a baseline. They are not measured improvements.

| ID | Proposed pilot measure | Measurement and guardrail |
| --- | --- | --- |
| OUT-01 | 80% of submitted requests decided within two business days | Server submission/decision timestamps; finance defines business calendar; report volume and distribution as well as median |
| OUT-02 | At least 8 of 10 observed employees identify their request's current status without help | Consented usability sessions with synthetic requests; do not log request text |
| OUT-03 | Zero accepted unauthorized or duplicate terminal decisions | Authorization/concurrency tests plus monitored denial/conflict counters; a quiet dashboard does not prove absence of incidents |

## Scope and acceptance contract

| ID | Requirement and observable acceptance |
| --- | --- |
| REQ-01 | An authenticated employee submits a title (1–120 trimmed characters), purpose (1–2,000), EUR amount (1–500,000 integer cents) and active designated approver. Invalid input leaves no request and shows field-specific errors. |
| REQ-02 | The assigned manager sees requester, title, purpose, amount, submission time and pending status. Approve records one approval; reject requires a reason (1–1,000 trimmed characters). The requester cannot decide their own request. |
| REQ-03 | Only organization members with an allowed relationship can read a request: its requester, its assigned approver, or a finance reviewer. Every read/write enforces organization and actor authorization on the server; guessed IDs must not disclose data. |
| REQ-04 | A request moves from pending to approved or rejected once. Concurrent decisions permit exactly one terminal change and one audit event. A retry with the same idempotency key and payload returns the original outcome. |
| REQ-05 | Requester, assigned approver and finance reviewer can read current status and authorized history. Audit records include actor, request, action, timestamp and reason where applicable. A committed decision and audit entry succeed together. |
| REQ-06 | Essential submission and decision journeys work by keyboard with visible focus, labeled controls, error summaries and announced asynchronous status. Target WCAG 2.2 AA; automated checks plus manual keyboard/screen-reader review provide evidence. |
| REQ-07 | Loading, empty, forbidden/not-found, validation, network failure and stale-decision states provide a next action without claiming an unconfirmed success or discarding entered rejection text. |
| REQ-08 | Pilot operation has a rollback rehearsal, restore evidence, access review and an assigned incident owner before real purchase data enters the service. |

Non-goals: executing payment, receipt uploads, reimbursements, multi-step approval, delegated approval, currency conversion, vendor management, email or chat notifications, editing or withdrawing submitted requests. Exclude support/admin bypasses from the pilot; approval changes require a new request and a linked explanation outside the original immutable decision.

## Experience and performance constraints

Support current organization-approved desktop/mobile browsers, a 320 CSS-pixel viewport, 200% zoom and reduced motion. Status uses text, not color alone. Display currency and time using the user's locale; store UTC timestamps and integer cents. Proposed performance budget: p95 detail API under 500 ms at 20 concurrent pilot sessions, measured in staging against an agreed fixture size. Never report this as achieved until tested.

## Data, security and operational constraints

Purpose/rejection text may contain confidential business information. Render it as text, exclude it from logs and analytics, prohibit credentials/payment details in UI guidance, and limit access by relationship and organization. Use the chosen identity provider and server session controls, including CSRF protection when cookies authenticate writes. Validate payloads server-side; bound request sizes and rate-limit abuse at the service boundary.

Proposed retention is 12 months for purchase/audit records; finance, privacy and security owners must decide lawful policy, deletion scope and backup expiry before production. No real data in demos. Avoid third-party analytics for the pilot. Secrets belong in the hosting provider's secret manager, never component frontmatter or a checked-in environment file.

## Risks, dependencies and release decision

| Risk/dependency | Owner role | Evidence needed |
| --- | --- | --- |
| Identity provider/role mapping unavailable | Engineering | Tested organization and role claims in staging |
| Managers bypass the workflow | Product | Discovery result and pilot agreement |
| Concurrent/retried decisions duplicate audit history | Engineering | T-04/T-05 integration evidence |
| Retention or accessibility requirements unresolved | Finance/privacy/design | Recorded policy decision and T-06 findings |
| No support capacity after launch | Service owner | Named on-call contact, runbook and rollback rehearsal |

Release requires the [acceptance/test map](05-delivery-plan.md), reviewed unresolved findings, and an explicit pilot decision in [REL-05](06-validation-and-release.md). Scope changes update affected REQ/UC/UI/test IDs before implementation.
