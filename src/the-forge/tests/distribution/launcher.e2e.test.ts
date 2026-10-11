import { beforeAll, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { errorCatalog } from '../../src/domain/shared/error-catalog.ts';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
beforeAll(async () => { await rm(join(fixture.bundle, 'bin/forge-runtime.js')); });

it('reports a missing runtime bundle as a JSON error instead of a Node stack trace', async () => {
  // An upgrade that replaced only bin/forge.js: the launcher alone cannot run a command.
  const result = await fixture.cli(['--version']);
  expect(result.status).toBe(errorCatalog.INVALID_SETUP.exitCode);
  expect(result.body).toEqual({
    ok: false,
    error: { code: 'INVALID_SETUP', message: expect.stringContaining(join(fixture.bundle, 'bin/forge-runtime.js')), hint: errorCatalog.INVALID_SETUP.hint, retryable: errorCatalog.INVALID_SETUP.retryable },
    events: [], warnings: [],
  });
  expect(result.body.error.message).toContain('bin/forge.js and bin/forge-runtime.js');
});
