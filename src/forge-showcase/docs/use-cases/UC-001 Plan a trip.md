---
schemaVersion: 1
type: use-case
title: UC-001 Plan a trip
owner: Trailhead product team
status: accepted
created: 2026-10-10
stage: 2
tags:
  - trailhead
  - use-case
requirements:
  - REQ-001
  - REQ-003
  - REQ-005
prd: "[[Trailhead PRD]]"
design: "[[Trip planner design]]"
---
# UC-001 Plan a trip

Owner: Trailhead product team. Use case ID: UC-001. Status: accepted.

## Requirement links and goal

Link the source PRD and REQ IDs. State the actor's goal and what observable outcome
counts as success. Keep the UC ID stable and replace example IDs when needed.

## Actors, trigger and preconditions

Describe primary/supporting actors, permissions, starting data, triggering action,
and assumptions about dependencies. Separate requirements from unverified conditions.

## Main flow

| Step | Actor action | System response | Requirement |
| --- | --- | --- | --- |
| 1 | Hiker types a destination | The summary announces "Planning: Lake Tahoe" ([[capture-destination]]) | REQ-001, REQ-005 |
| 2 | Hiker saves the draft | The form is stored as trailhead-trip-draft ([[save-trip-draft]]) | REQ-001 |
| 3 | Hiker marks a trip as favourite | The [[trip-card]] button is pressed and the change is emitted ([[toggle-favorite]]) | REQ-003 |

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
| UC-001-A | the planner is open | the hiker saves "Lake Tahoe" for 2 nights | the trip is stored through [[trips-api]] | REQ-001 |

## Uncertainties and decisions

Record unresolved business rules, edge cases, owner, and decision evidence. Status: open
until the uncertainty is resolved explicitly.

## Review and evidence

Link walkthrough notes and review decisions. Execution evidence: not collected.
Carry these example IDs into the build spec and test plan.

## Knowledge graph

Implements [[Trailhead PRD]] requirements REQ-001, REQ-003 and REQ-005 on the [[trip-planner]] page. Designed in [[Trip planner design]]; verified by [[Trip planner test plan]].
