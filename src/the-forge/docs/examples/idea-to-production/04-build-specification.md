---
id: SPEC-001
status: proposed
prd: PRD-001
useCase: UC-01
---
# Build specification: request submission and decision

## Implementation boundary

The Forge manages Markdown definitions, generates UI/stories and scaffolds a TypeScript project. It does not implement this product's persistence, identity integration, application state, API, visual styling or deployment. This specification describes work to implement after generation. Proposed pilot stack: TypeScript domain/application modules, a React web client, a Node HTTP adapter and PostgreSQL. Runtime versions, framework setup, provider and operational ownership require project decisions and a committed dependency lockfile.

The `sources` directory adds two concrete data contracts. [`purchase-requests.md`](sources/purchase-requests.md) generates a typed REST **read** adapter and synthetic records matching the pending detail fixture; [`approvers.md`](sources/approvers.md) generates a local-JSON adapter and demo approver records. The REST adapter validates scalar transport shape; domain rules still enforce integer money, bounds, authorized actors and transitions. Submission and decision APIs use distinct command payloads and remain handwritten application work. Do not treat generic CRUD as an authorization or idempotency mechanism.

Generated adapters belong in `src/infrastructure/generated`, fixtures in `testdata/generated`. `json.path` in the approver definition deliberately matches `testdata/generated/approvers.fixtures.json`; an injected loader resolves it relative to the consuming project. In a browser, configure an explicit development fixture URL or bundler import rather than assuming filesystem paths are public URLs. Production approver eligibility comes from the identity-backed server, not this fixture.

## Routes and composition

| Route | Actors | Composition and behavior |
| --- | --- | --- |
| `/requests` | Organization members | Page → header/nav → main → request list or empty state; server filters by actor relationship; each row names status and amount |
| `/requests/new` | Employees | Page → labeled title/purpose/amount/approver form → error summary → submit; success navigates to created detail |
| `/requests/:id` | Requester, assigned approver, finance | Page → header/nav → main → h1 → request summary → authorized decision controls → chronological audit history |

The supplied [`approval-page`](components/approval-page.md) composes [`request-summary`](components/request-summary.md) and child content. It establishes semantic landmarks, headings, copy and scalar bindings. The child slot shows how application-owned actions can be composed, but the fixture's child link only returns to the list. The host application must integrate actual buttons, state transitions, error announcements and permission-sensitive rendering. Generating stories does not make those behaviors exist.

## Required view states

| ID | State and expected behavior |
| --- | --- |
| UI-01 | Loading: identify the loading region, preserve page heading, offer a next action after a bounded request timeout |
| UI-02 | Pending: render authorized request details; show decision actions only for the assigned manager |
| UI-03 | Confirm approval: inline confirmation identifies title/amount, cancel returns focus to Approve |
| UI-04 | Saving: disable duplicate submission, announce progress, keep surrounding content readable |
| UI-05 | Decided: status text, actor, timestamp and rejection reason if applicable; no remaining decision actions |
| UI-06 | Reject form: labeled textarea with character limit, clear submit/cancel controls |
| UI-07 | Invalid: summary links to field errors; preserve input and focus the summary |
| UI-08 | Stale: explain the current decision and offer draft-copy action; do not retry a stale command automatically |
| UI-09 | Network/service uncertainty: avoid success claims, retain draft, retry with the original idempotency key |
| UI-10 | Not found/forbidden: same public response and recovery link without leaking request content |
| UI-11 | Empty list: explain absence of visible requests and provide Create request for eligible employees |

Use system fonts initially, a restrained color palette with measured contrast, and one spacing scale. Keep actions visible on narrow screens, allow long titles to wrap, and use explicit currency/status labels. No animated transition is essential. Native Storybook extensions should host interaction tests, provider decorators and mocked server responses. Keep callable code out of frontmatter; declare each story name in Markdown and supply its native behavior in a reviewed extension.

## Domain and API contract

`PurchaseRequest` contains `id`, `organizationId`, `requesterId`, `approverId`, `title`, `purpose`, `amountMinor`, `currency: 'EUR'`, `status: 'pending' | 'approved' | 'rejected'`, positive integer `revision`, UTC `submittedAt`, and an optional terminal decision containing `actorId`, `decidedAt` and rejection `reason`. Request/actor IDs are opaque; derive organization and actor from the verified session, never trust client-supplied ownership. Restrict purpose/title/reason according to REQ-01/02.

| Endpoint | Contract |
| --- | --- |
| `POST /api/requests` | `{title,purpose,amountMinor,currency,approverId}` plus `Idempotency-Key`; return `201` with created pending record; validate approver belongs to the same organization and differs from requester |
| `GET /api/requests` | Authorized, paginated list; opaque `cursor`, bounded `limit` (default 25, max 100); stable ordering by submission time and ID |
| `GET /api/requests/:id` | Authorized record and history, including revision; return indistinguishable `404` for unavailable records |
| `POST /api/requests/:id/decision` | `{action:'approve'|'reject',expectedRevision,reason?}` plus `Idempotency-Key`; `200` committed decision, `409` stale revision or key/payload conflict, `422` invalid payload, `401` unauthenticated, `404` unavailable, `503` transient service failure |

Error body: `{code, message, requestId, fieldErrors?}`. Do not leak stack traces, other organizations' identifiers or protected current-state details. Authorized stale clients may refresh the record after a `409`. Server-generated times are authoritative. Validate expected revision as a positive integer. Reject a reason on approve, require one on reject, and enforce business rules regardless of the UI.

Persist idempotency records scoped by organization, actor and endpoint/resource; store payload hash and prior response in the same transaction as the mutation. Match a previous successful key before applying stale-revision checks so response-loss retries succeed. Reject changed payload reuse. Proposed key retention is 24 hours; document the supported retry window and have the client refresh state rather than resend after it. Even after expiry, terminal-state checks prevent a second decision.

## Boundaries and decisions

| ID | Proposed decision | Why; consequence and reconsideration trigger |
| --- | --- | --- |
| ADR-01 | Pure domain/application logic with injected repository, clock and ID ports | Test policy independently of HTTP/database; revisit only if abstractions carry no behavior |
| ADR-02 | Optimistic revision check plus transactional request/audit/idempotency writes | Handle races and uncertain responses; database adapter must prove atomicity and concurrent behavior |
| ADR-03 | Generate presentational React components, keep feature orchestration handwritten | Deterministic regeneration remains reviewable; fixtures cannot express arbitrary hooks/events |
| ADR-04 | Single EUR currency and integer minor units | Avoid rounding/conversion ambiguity; adding currencies requires explicit scale/format policy |
| ADR-05 | Audit table writable only through application transaction, no normal-user edits | Prevent casual history mutation; this is not a claim of cryptographic tamper-proof storage |

Domain owns status transitions, limits and decision invariants. Application owns authorization policy orchestration and transaction ports. Infrastructure owns identity, SQL and HTTP. Presentation owns forms, loading/error state and accessibility. Escape display text, bind SQL parameters and explicitly enumerate payload fields.

Proposed paths inside the managed project: `src/domain`, `src/application`, `src/infrastructure`, `src/presentation`, generated `src/ui/generated`, and generated `stories/generated`. Workspace definitions live separately under the example's `components` directory. Choose and record paths before generating; do not place handwritten orchestration into generated files. New framework builds and Storybook scripts must be configured in the consuming project; the initial Forge scaffold is a TypeScript library with a form showcase.
