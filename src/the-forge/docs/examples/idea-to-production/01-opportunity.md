---
id: OP-001
status: hypothesis
owner: Product owner (role; assign a person before discovery)
---
# Opportunity: resolve small purchase requests without losing decisions

## Problem and audience

Hypothesis: employees at a 30–150 person organization submit small purchase requests through chat, and managers lose track of decisions. The resulting uncertainty delays purchases and makes it difficult for finance to explain who approved a cost.

Illustrative job statement: “When I need a work tool, I want a recorded decision with a reason, so I know whether I can buy it without repeatedly asking my manager.” This is a proposed job statement, not an interview quotation.

Employees need a visible current status. Managers need enough context to decide without searching chat. Finance needs a consistent history; it does not need another payment system. Start with one organization and one designated approver per request. Requests cover EUR purchases from €0.01 through €5,000.00; the cap is a proposed pilot policy to validate with finance.

## Evidence and uncertainty

| ID | Hypothesis | Evidence to collect | What would change the decision |
| --- | --- | --- | --- |
| H-01 | Requests are delayed by missing context | Observe five recent requests with participants' permission; record timestamps without copying sensitive content | If procurement policy is the bottleneck, fix that before building |
| H-02 | Managers can decide from amount, purpose and requester | Test a paper detail view with three managers | Add only fields they demonstrably need |
| H-03 | A decision history is sufficient for finance | Ask finance to reconstruct two fictional requests from the proposed audit record | Revisit the data contract if records cannot support reconciliation |

Evidence register: **empty**. Baseline time to decision, request volume and follow-up count: **unknown**. Recruitment, interview consent and storage policy must be agreed before research. Prefer synthetic examples in design tools.

## Options and smallest useful experiment

1. Standardize a chat request template and shared tracking sheet for two weeks.
2. Prototype a request detail page and run task-based sessions.
3. Build the narrow workflow only if discovery supports H-01–H-03 and a product owner funds operation.

Proposed decision: run options 1 and 2 before committing to option 3. Product owner records the actual decision, date, evidence links and unresolved risks in this file. If a sheet solves the problem adequately, stop here.

## Outcome and constraints

Desired outcome: fewer unresolved requests and less employee follow-up, without unauthorized decisions. Candidate success measures are specified in [OUT-01–03](02-prd.md#outcomes); they are targets for discussion, not results. Discovery budget: one working week proposed. No connection to bank accounts, purchasing cards or payroll. A real deployment needs a named service owner and an approved retention policy.
