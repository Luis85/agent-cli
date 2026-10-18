import { probeFamily } from '../support/idempotency.ts';

/** `idempotentHint` against a repeated invocation for setup, the server lifecycle, projects, workflows and webviews; `idempotency.integration` checks that the families cover every mutating mode. */
probeFamily('workspace');
