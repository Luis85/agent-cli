# Example: Team Purchase Approvals

A filled-in example of turning a product idea into reviewable production work with The Forge. The example product lets employees request small purchases and lets a designated manager approve or reject them. It is a specification and generation fixture, **not an implemented or deployed application**.

All organizations, user quotations, numbers and proposed thresholds below are illustrative. No interviews, usability sessions, security review or production measurement have been conducted. Replace assumptions with linked evidence before making real commitments. A decision marked “proposed” is awaiting the responsible team's decision; it is not an approval.

Read in order:

| Artifact | Purpose |
| --- | --- |
| [01-opportunity.md](01-opportunity.md) | Establish the problem and a plan to gather evidence |
| [02-prd.md](02-prd.md) | Define outcomes, scope and acceptance criteria |
| [03-use-case.md](03-use-case.md) | Specify a complete decision journey, including failures |
| [04-build-specification.md](04-build-specification.md) | Describe UI, data contracts and implementation boundaries |
| [05-delivery-plan.md](05-delivery-plan.md) | Sequence independently verifiable implementation slices |
| [06-validation-and-release.md](06-validation-and-release.md) | Plan verification, rollout, rollback and operational ownership |
| [prompts.md](prompts.md) | Copy stage prompts with explicit inputs and expected evidence |
| [components](components) | Valid Markdown UI definitions for a static detail view |
| [sources](sources) | REST read-model and local-JSON definitions with explicit synthetic test records |

The [walkthrough](../../tutorials/idea-to-production.md) demonstrates real Forge commands. Keep product documents, `components` and `sources` separate: each library recursively validates its Markdown files against its own strict schema. Product frontmatter is ordinary document metadata, not a UI or data-source definition.

Traceability convention: `OP-*` opportunity, `OUT-*` outcome, `REQ-*` requirement, `UC-*` use case, `UI-*` interface state, `ADR-*` decision, `S-*` delivery slice, `T-*` test and `REL-*` release check. Preserve IDs when refining text. Link evidence in the release ledger; never substitute a generated file or an unexecuted test plan for a passed test.
