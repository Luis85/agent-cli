import { afterEach, expect, it, vi } from 'vitest';
import { processAlive } from '../../src/infrastructure/workspace/process-probe.ts';

afterEach(() => { vi.restoreAllMocks(); });

const failing = (code: string) => vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error(code), { code }); });

it('reports this process as alive with a signal-0 probe', () => {
  const kill = vi.spyOn(process, 'kill');
  expect(processAlive(process.pid)).toBe(true);
  expect(kill).toHaveBeenCalledWith(process.pid, 0);
});

it.each([
  ['EPERM', true],
  ['ESRCH', false],
  ['EINVAL', undefined],
] as const)('maps a %s probe failure to %s (EPERM: the process exists but belongs to another user)', (code, alive) => {
  failing(code);
  expect(processAlive(4242)).toBe(alive);
});
