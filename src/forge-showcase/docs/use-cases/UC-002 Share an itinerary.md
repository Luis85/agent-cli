---
schemaVersion: 1
type: use-case
title: UC-002 Share an itinerary
owner: Trailhead product team
status: accepted
created: 2026-10-10
stage: 2
tags:
  - trailhead
  - use-case
requirements:
  - REQ-004
prd: "[[Trailhead PRD]]"
design: "[[Trip planner design]]"
---
# UC-002 Share an itinerary

Owner: Trailhead product team. Use case ID: UC-002. Status: accepted.

## Requirement links and goal

Link the source PRD and REQ IDs. State the actor's goal and what observable outcome
counts as success. Keep the UC ID stable and replace example IDs when needed.

## Actors, trigger and preconditions

Describe primary/supporting actors, permissions, starting data, triggering action,
and assumptions about dependencies. Separate requirements from unverified conditions.

## Main flow

| Step | Actor action | System response | Requirement |
| --- | --- | --- | --- |
| 1 | Hiker shares a planned trip | ShareItinerary confirms the itinerary exists before a link is offered | REQ-004 |

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
| UC-002-A | an unknown itinerary | the hiker shares it | no link is offered | REQ-004 |

## Uncertainties and decisions

Record unresolved business rules, edge cases, owner, and decision evidence. Status: open
until the uncertainty is resolved explicitly.

## Review and evidence

Link walkthrough notes and review decisions. Execution evidence: not collected.
Carry these example IDs into the build spec and test plan.

## Knowledge graph

Implements [[Trailhead PRD]] requirement REQ-004 using [[trips-api]]. Specified in [[Trip planner build spec]]; verified by [[Trip planner test plan]].
