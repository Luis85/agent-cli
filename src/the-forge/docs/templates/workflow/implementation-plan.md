---
schemaVersion: 1
type: implementation-plan
title: '{{title}}'
owner: '{{owner}}'
status: draft
created: '{{date:YYYY-MM-DD}}'
---
# {{title}}

Owner: {{owner}}. Status: draft; all work below is planned until evidence is recorded.

## Inputs and acceptance boundary

Link the PRD, use cases, build spec, and DSN decisions. Identify the smallest complete
delivery slice, its acceptance examples, and excluded work.

## Ordered implementation tasks

| ID | Change and observable outcome | Depends on | REQ / UC / DSN | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| IMP-001 | TBD | none or task ID | TBD | {{owner}} | planned |

Keep task IDs stable. Sequence contracts/invariants, adapters, UI composition, and end-to-end
wiring so each step can be reviewed. Delegate independent ownership explicitly when useful.

## Files, generation and ownership

List authored files and generated artifacts, scope (workspace/project), configured paths,
and generators to invoke. Capture dry-run previews and current revisions before replacing
outputs. State which generated code will receive project-specific behavior.

## Dependencies and integration

Identify packages, external services, datasource configuration, migrations, and environment
requirements. Record exact install/build commands and working directories before running
them. Planning does not authorize deployment or imply dependencies are installed.

## Verification per task

Map each task to the smallest useful checks, then the complete project gate. Include
failure/recovery cases and a test-plan link. Report actual command outcomes and artifacts.

## Review and completion criteria

Define code review, documentation updates, generated bundle updates, and release handoff.
A task is complete only when its agreed behavior is implemented and relevant checks pass.

## Uncertainties and decisions

Record blockers, owners, decision deadlines, and evidence needed to unblock work.

## Progress and evidence

| Task | Commit or change | Verification evidence | Review | Status |
| --- | --- | --- | --- | --- |
| IMP-001 | not implemented | not run | pending | planned |
