import { describe, expect, it } from 'vitest';
import { Itinerary } from '../../src/domain/trips/itinerary.ts';
import { TripPlannedEvent } from '../../src/domain/trips/trip-planned.ts';
import { TripWindow } from '../../src/domain/trips/trip-window.ts';

describe('Trailhead trip model', () => {
  it('requires an itinerary identity', () => {
    expect(() => Itinerary.create('  ')).toThrow('Itinerary requires an identity');
    expect(Itinerary.create('itinerary-lakeside').id).toBe('itinerary-lakeside');
  });

  it('compares trip windows by value and keeps them immutable', () => {
    const window = TripWindow.from('2026-10-16/2026-10-18');
    expect(window.equals(TripWindow.from('2026-10-16/2026-10-18'))).toBe(true);
    expect(window.equals(TripWindow.from('2026-11-01/2026-11-03'))).toBe(false);
    expect(Object.isFrozen(window)).toBe(true);
    expect(() => TripWindow.from('')).toThrow('TripWindow cannot be empty');
  });

  it('validates trip-planned event payloads', () => {
    expect(TripPlannedEvent.id).toBe('app.trip-planned');
    expect(TripPlannedEvent.validate({ id: 'trip-lakeside' })).toBe(true);
    expect(TripPlannedEvent.validate({ id: 42 })).toBe(false);
    expect(TripPlannedEvent.validate(null)).toBe(false);
  });
});
