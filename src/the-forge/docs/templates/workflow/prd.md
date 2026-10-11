---
schemaVersion: 1
type: prd
title: '{{title}}'
owner: '{{owner}}'
status: draft
created: '{{date:YYYY-MM-DD}}'
---
# {{title}}

Owner: {{owner}}. Status: draft; this document records intent, not completed delivery.

## Problem and evidence

Describe the user's current difficulty, who experiences it, and the evidence that it matters.
Link interviews, issues, measurements, or existing behavior. Mark assumptions as unverified.

## Users and desired outcome

Identify primary users, context, and an observable improvement. Define the baseline,
target, measurement method, and evaluation period; use TBD where evidence is missing.

## Scope and exclusions

List included capabilities and explicit exclusions. Identify dependencies and boundaries
with existing systems; do not turn unspecified integrations into commitments.

## Requirements

| ID | User need and expected behavior | Acceptance example | Priority | Owner |
| --- | --- | --- | --- | --- |
| REQ-001 | TBD | Given / When / Then: TBD | TBD | {{owner}} |

Keep IDs stable as requirements change. Link each requirement to a use case and later
to implementation and test evidence. Include failure, accessibility, privacy, and data needs.

## Success measures and constraints

Describe performance, compatibility, accessibility, operating cost, and delivery constraints
that affect this scope. State a measurable threshold or record an open question.

## Uncertainties and decisions

| ID | Question or assumption | Evidence needed | Owner | Status |
| --- | --- | --- | --- | --- |
| Q-001 | TBD | TBD | {{owner}} | open |

## Review and evidence

Record reviewer, date, reviewed version, decisions, and links to evidence when available.
Readiness: not assessed. Do not mark requirements accepted without a recorded review.

## Next artifact

Create linked use cases for REQ IDs; resolve scope uncertainties before committing a build spec.
