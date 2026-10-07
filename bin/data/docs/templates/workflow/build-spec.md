---
schemaVersion: 1
type: build-spec
title: '{{title}}'
owner: '{{owner}}'
status: draft
created: '{{date:YYYY-MM-DD}}'
---
# {{title}}

Owner: {{owner}}. Status: draft. Implementation readiness: not assessed.

## Source requirements and use cases

Link the PRD, REQ IDs, use cases, and acceptance examples. Define the bounded feature
and retain a trace from each proposed change to a user outcome.

## Domain and architecture

Describe entities, value objects, invariants, use cases, and dependency direction.
Separate domain rules from application orchestration, infrastructure adapters, and presentation.
Record existing conventions and boundaries before proposing new abstractions.

## Contracts and data flow

Specify inputs, outputs, errors, validation, authorization, and state transitions.
Identify datasource ownership, query/mutation contracts, and injected ports. Keep secrets
out of specifications and generated artifacts; reference configuration keys only.

## UI and integration scope

Link UI Markdown definitions, selected framework, component children/props, Storybook
requirements, and native extension needs. Describe real external integration contracts
and distinguish a scaffold from a working connection.

## Configurable paths and generated artifacts

| Artifact | Source path | Destination path | Scope | Requirement |
| --- | --- | --- | --- | --- |
| TBD | TBD | TBD | workspace or project | REQ-001 |

State generation/import/export paths, overwrite guards, deterministic inputs, and which
outputs are application-owned after generation. Preview changes before writing.

## Acceptance and verification

Map requirements to concrete checks, fixtures, and expected failure behavior. Define
compatibility and performance thresholds where required, and explain how they will be measured.

## Uncertainties and decisions

List unresolved contracts, dependencies, tradeoffs, and decision owners. Mark assumptions
unverified and record evidence when a decision changes the specification.

## Review and evidence

Record architecture review and links to actual experiments. No build or integration result
is implied by this draft. Next: design decisions and ordered implementation tasks.
