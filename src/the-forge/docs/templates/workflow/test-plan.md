---
schemaVersion: 1
type: test-plan
title: '{{title}}'
owner: '{{owner}}'
status: draft
created: '{{date:YYYY-MM-DD}}'
---
# {{title}}

Owner: {{owner}}. Status: draft. Overall result: not run.

## Coverage and traceability

Link source requirements, UC examples, DSN decisions, and implementation tasks.
Define risks and observables; avoid tests that merely restate implementation details.

| ID | REQ / UC / IMP | Scenario and expected outcome | Layer | Owner |
| --- | --- | --- | --- | --- |
| TEST-001 | TBD | TBD | unit / integration / end-to-end | {{owner}} |

## Test pyramid

Use unit tests for domain invariants and deterministic transforms, integration tests for
collaborating boundaries, and a focused end-to-end set for complete user workflows.
Include malformed inputs, stale revisions, path boundaries, and partial-write prevention
where generated/imported/exported artifacts are involved.

## Fixtures and environments

Describe representative data, empty/error states, external service substitutes, supported
framework/compiler versions, and reproducible setup. Keep credentials out of fixtures.
State which real integrations need separately authorized environments.

## UI, accessibility and compatibility

Specify Storybook builds, native interaction checks, keyboard/focus checks, responsive
coverage, and supported browsers/frameworks. Record remaining manual checks explicitly.
Structural validation alone does not establish runtime behavior or accessibility.

## Commands and expected results

| Check | Working directory | Command | Expected result | Evidence path |
| --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD |

## Execution evidence

| Test or gate | Version / environment | Actual result | Evidence | Follow-up |
| --- | --- | --- | --- | --- |
| TEST-001 | TBD | not run | none yet | pending |

## Uncertainties and decisions

Record coverage gaps, flaky behavior, unknown requirements, owners, and disposition.

## Exit criteria and review

Define required passing checks and acceptable explicitly reviewed limitations. Record
review decisions and residual risks before handing evidence to the release plan.
