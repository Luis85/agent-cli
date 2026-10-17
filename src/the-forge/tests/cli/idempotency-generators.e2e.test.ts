import { probeFamily } from '../support/idempotency.ts';

/** `idempotentHint` against a repeated invocation for templates, code generators and skills; `idempotency.integration` checks that the families cover every mutating mode. */
probeFamily('generators');
