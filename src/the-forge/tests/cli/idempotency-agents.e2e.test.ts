import { probeFamily } from '../support/idempotency.ts';

/** `idempotentHint` against a repeated invocation for agent definitions and native Claude assets; `idempotency.integration` checks that the families cover every mutating mode. */
probeFamily('agents');
