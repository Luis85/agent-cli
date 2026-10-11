import { describe, expect, it, vi } from 'vitest';
import { PlanTrip } from '../src/application/plan-trip.ts';

describe('PlanTrip', () => {
  it('rejects invalid input before accessing persistence', async () => {
    const exists = vi.fn(async () => true);
    await expect(new PlanTrip({ exists }).execute('   ')).rejects.toThrow('Identity is required');
    expect(exists).not.toHaveBeenCalled();
  });
  it.each([true, false])('returns the repository result: %s', async present => {
    const exists = vi.fn(async (id: string) => id === 'item-1' && present);
    await expect(new PlanTrip({ exists }).execute('item-1')).resolves.toEqual({ exists: present });
    expect(exists).toHaveBeenCalledExactlyOnceWith('item-1');
  });
});
