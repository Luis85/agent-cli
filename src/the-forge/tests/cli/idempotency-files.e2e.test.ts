import { probeFamily } from '../support/idempotency.ts';

/** `idempotentHint` against a repeated invocation for file commands in a selected project; `idempotency.integration` checks that the families cover every mutating mode. */
probeFamily('files');
