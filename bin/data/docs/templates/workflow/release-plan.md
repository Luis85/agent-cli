---
schemaVersion: 1
type: release-plan
title: '{{title}}'
owner: '{{owner}}'
status: draft
created: '{{date:YYYY-MM-DD}}'
---
# {{title}}

Owner: {{owner}}. Status: draft. Release readiness: not assessed. Deployment: not performed.

## Scope and release identity

Link approved requirements, completed implementation tasks, reviewed change/PR, and target
version or commit. State included changes and explicit exclusions.

## Readiness evidence

| Gate | Required evidence | Actual evidence | Owner | Status |
| --- | --- | --- | --- | --- |
| Requirements acceptance | linked REQ / UC decisions | not collected | {{owner}} | pending |
| Test and compatibility gates | linked TEST outcomes | not run | {{owner}} | pending |
| Review and documentation | recorded review and current docs | pending | {{owner}} | pending |

Do not infer readiness from generated files, a test plan, or a successful dry run.

## Release procedure

| ID | Action | Working directory / environment | Command or owner | Verification |
| --- | --- | --- | --- | --- |
| REL-001 | TBD | TBD | TBD | TBD |

State artifact paths, build inputs, configuration keys, migration ordering, target
environment, and authorization needed before publishing or deployment. Keep secrets out.

## Rollback and recovery

Define rollback trigger, last known good artifact, restoration steps, data compatibility,
responsible person, and a verification method. Mark untested recovery procedures as untested.

## Observability and post-release checks

List meaningful health/user checks, expected signals, monitoring period, and incident owner.
Record actual observations after release; do not pre-fill successful outcomes.

## Communication and handoff

Draft release notes, user-visible changes, operating guidance, and ownership handoff.
Identify intended recipients; this document does not send messages or publish announcements.

## Uncertainties and decisions

Record unresolved operational risks, decisions, owners, and evidence needed for readiness.

## Execution evidence and review

Record authorization, artifact/commit, timestamps, observed results, and rollback decisions
only after they occur. Final status: pending.
