import { probeFamily } from '../support/idempotency.ts';

/** `idempotentHint` against a repeated invocation for component, interaction and data-source libraries and their generators; `idempotency.integration` checks that the families cover every mutating mode. */
probeFamily('libraries');
