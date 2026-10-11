---
schemaVersion: 1
type: design
title: '{{title}}'
owner: '{{owner}}'
status: draft
created: '{{date:YYYY-MM-DD}}'
---
# {{title}}

Owner: {{owner}}. Design decision ID: DSN-001. Status: draft.

## Context and traceability

Link REQ IDs, UC acceptance examples, and the build spec. Describe the user context,
technical constraints, and the specific decision this design resolves.

## User journey and information structure

Describe entry points, sequence, navigation, terminology, and exit/recovery paths.
Identify what users need to understand or decide at each stage.

## Component composition and states

Map page/layout/header/navigation and feature components to library IDs, props, children,
and data contracts. Cover loading, empty, populated, invalid, error, and success states.
Identify native code needed for interactions beyond generated semantic boilerplate.

## Accessibility and responsive behavior

Specify semantic structure, accessible names, keyboard/focus behavior, error announcements,
contrast requirements, motion preferences, and small/large viewport behavior.
State planned verification methods; a specification alone is not an accessibility result.

## Alternatives and decision

| Option | User impact | Technical cost | Evidence or uncertainty |
| --- | --- | --- | --- |
| TBD | TBD | TBD | unverified |

Record the selected option, rationale, and tradeoffs after review. Decision: pending.

## Storybook and examples

List representative named stories, args, controls, documentation, and interaction tests.
Link native Storybook extensions where lifecycle hooks are needed. Do not claim stories
or tests exist before generating, building, and checking them.

## Uncertainties and decisions

Record open usability questions, unknown device constraints, dependencies, and owners.

## Review and evidence

Link sketches, prototypes, screenshots, usability observations, and decisions with dates.
Validation status: not assessed. Carry DSN-001 into implementation and tests.
