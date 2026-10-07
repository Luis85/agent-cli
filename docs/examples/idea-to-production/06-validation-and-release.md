---
id: REL-001
status: not-ready
plan: PLAN-001
---
# Validation, pilot release and operation

This is a release plan, not a completed checklist. Evidence status for every entry is **not run**. Replace role labels with named owners, record artifacts from the actual build and decide unresolved policy questions before a production launch.

## Release evidence ledger

| ID | Required evidence | Owner role | Current status |
| --- | --- | --- | --- |
| REL-01 | T-01–07 mapped to executed tests/manual findings on the release commit; agreed accessibility findings resolved or explicitly dispositioned | Engineering + design | Not run |
| REL-02 | Identity/tenant isolation review, secrets configuration, approved retention policy, dependency review, database least-privilege checks | Security + finance/privacy | Not run |
| REL-03 | Staging load result, successful backup restore and rollback rehearsal using a synthetic dataset | Service owner | Not run |
| REL-04 | Versioned deploy artifact, migrations, provider-specific runbook, health check, dashboards and named incident contact | Engineering + service owner | Not run |
| REL-05 | Product/operations pilot decision listing evidence links, audience, known limitations, stop conditions and authorizing person | Product + service owner | Not decided |

## Before any deploy

Choose the hosting provider, database, identity integration, environment names and secret mechanism. Record the real build, migration, deploy and rollback commands in the consuming project's runbook and exercise them in staging. `npm run build` compiles artifacts; it does not deploy. The Forge has no deploy command. Never paste a guessed cloud CLI command or run a production migration from an unresolved prompt placeholder.

Build from a reviewed commit with a committed dependency lockfile; retain artifact identity and checksums. Keep generated CSF and the chosen Storybook configuration under review. Run Storybook's actual configured build and interaction checks once installed; “compatible CSF” does not imply a tested live preview. Verify that browser assets contain no secrets, source-map exposure matches policy and real purchases are absent from fixtures.

Prefer additive, backwards-compatible database migrations during the pilot. Deploy schema additions first, then application code. Rehearse old/new application compatibility against the migrated schema. Destructive cleanup is separate work with its own data-retention decision; restoring a stale backup is not a routine code rollback.

## Pilot and stop conditions

Proposed pilot audience: one team with up to 20 consenting users, synthetic data in staging, then real requests only after REL-05. Enable submission/decision writes for that team through a server-side feature flag. Start with one approved smoke request, verify its authorized history and remove synthetic data through the approved retention process.

Monitor decision success/latency, technical failures, authorization denials and revision conflicts, tagged with non-sensitive request IDs. Proposed alert: decision-write 5xx rate above 2% over 10 minutes with at least 20 attempts; below that volume investigate two consecutive failures. These thresholds need operational review. Any confirmed authorization leak, audit inconsistency or duplicate terminal decision stops writes immediately and invokes the incident owner.

## Rollback and recovery procedure

1. Incident owner disables decision/submission writes server-side and records the release/incident identifiers. Keep read access only if its authorization is trustworthy.
2. Inspect database/audit consistency and distinguish an application fault from data corruption. Preserve relevant technical evidence without copying confidential request text into tickets.
3. For a code regression, run the tested provider rollback command to the previous immutable artifact; use its recorded schema-compatibility evidence. Do not reverse destructive schema changes automatically.
4. For corrupted data, follow the rehearsed restore/reconciliation procedure with the data owner. Proposed recovery goals are 4 hours recovery time and 15 minutes recovery point; approve them and prove them in staging before relying on them.
5. Execute authorized-read and idempotent-decision smoke tests. Re-enable writes only after incident owner accepts evidence. Inform affected participants through the team's agreed incident process; the agent must not send messages without explicit authorization.

## Outcome review

At two weeks, product owner compares OUT-01/02 against the measured discovery baseline and reports sample size, missing data and confounders. Review OUT-03 through tests, incidents and access logs rather than absence of complaints. Decide continue, change scope or stop. Record unexpected user workarounds, support load and accessibility findings as traceable follow-up requirements. Delete/export pilot data only through the approved policy and access controls.
