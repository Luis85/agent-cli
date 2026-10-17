import { probeFamily } from '../support/idempotency.ts';

/** `idempotentHint` against a repeated invocation for backlog writes; `idempotency.integration` checks that the families cover every mutating mode. */
probeFamily('backlog');
