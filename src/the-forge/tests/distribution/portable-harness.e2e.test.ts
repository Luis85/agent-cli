import { expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();

it('keeps the test worker responsive while the copied CLI runs', async () => {
  // A worker whose event loop is blocked by synchronous child processes cannot answer Vitest's RPC, time out a
  // test or serve an in-process fake; timers keep firing while an asynchronous call is pending.
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 1);
  try {
    const listed = await fixture.cli(['list']);
    expect(listed.status).toBe(0);
    expect(listed.body.ok).toBe(true);
  } finally { clearInterval(timer); }
  expect(ticks).toBeGreaterThan(0);
});
