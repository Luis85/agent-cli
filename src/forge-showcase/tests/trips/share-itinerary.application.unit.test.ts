import { describe, expect, it, vi } from 'vitest';
import { ShareItinerary } from '../../src/application/trips/share-itinerary.ts';

describe('ShareItinerary', () => {
  it('rejects a blank itinerary before reading the repository', async () => {
    const exists = vi.fn(async () => true);
    await expect(new ShareItinerary({ exists }).execute({ id: ' ' })).rejects.toThrow('Identity is required');
    expect(exists).not.toHaveBeenCalled();
  });

  it('reports whether the itinerary can be shared', async () => {
    const exists = vi.fn(async (id: string) => id === 'itinerary-lakeside');
    await expect(new ShareItinerary({ exists }).execute({ id: 'itinerary-lakeside' })).resolves.toEqual({ exists: true });
    await expect(new ShareItinerary({ exists }).execute({ id: 'itinerary-unknown' })).resolves.toEqual({ exists: false });
  });
});
