---
schemaVersion: 1
type: use-case
title: '{{title}}'
owner: '{{owner}}'
status: draft
created: '{{date:YYYY-MM-DD}}'
---
# {{title}}

Owner: {{owner}}. Use case ID: UC-001. Status: draft.

## Requirement links and goal

Link the source PRD and REQ IDs. State the actor's goal and what observable outcome
counts as success. Keep the UC ID stable and replace example IDs when needed.

## Actors, trigger and preconditions

Describe primary/supporting actors, permissions, starting data, triggering action,
and assumptions about dependencies. Separate requirements from unverified conditions.

## Main flow

| Step | Actor action | System response | Requirement |
| --- | --- | --- | --- |
| 1 | TBD | TBD | REQ-001 |

Describe each response visibly enough that another person can verify the flow.

## Alternate and failure flows

Cover empty data, invalid input, missing permission, unavailable services, retries,
duplicate actions, and cancellation where relevant. Specify the recovery path.

## Postconditions and invariants

State what changes on success, what remains true on failure, and who owns persisted data.
Identify business invariants, external side effects, and any compensation needed.

## Acceptance examples

| ID | Given | When | Then | Requirement |
| --- | --- | --- | --- | --- |
| UC-001-A | TBD | TBD | TBD | REQ-001 |

## Uncertainties and decisions

Record unresolved business rules, edge cases, owner, and decision evidence. Status: open
until the uncertainty is resolved explicitly.

## Review and evidence

Link walkthrough notes and review decisions. Execution evidence: not collected.
Carry these example IDs into the build spec and test plan.
