import { describe, expect, it } from 'vitest';
import { Trip } from '../src/domain/trip.ts';

describe('Trip', () => {
  it.each(['', '   '])('rejects an empty identity: %j', id => {
    expect(() => Trip.create(id)).toThrow('Identity is required');
  });
  it('retains a valid identity', () => {
    expect(Trip.create('item-1').id).toBe('item-1');
  });
});
