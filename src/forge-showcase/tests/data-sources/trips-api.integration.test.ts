import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createTripRecordDataSource, TripRecordDataSourceError, type TripRecord } from '../../src/infrastructure/data-sources/trips-api.ts';

const fixtures = JSON.parse(await readFile(new URL('../../test-data/trips-api.fixtures.json', import.meta.url), 'utf8')) as TripRecord[];

function serve(status: number, body: unknown, requests: Request[] = []): typeof fetch {
  return async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
}

describe('trips-api REST adapter', () => {
  it('lists trips from the nested response path with sorted query parameters', async () => {
    const requests: Request[] = [];
    const trips = createTripRecordDataSource({ fetch: serve(200, { data: { items: fixtures } }, requests) });
    await expect(trips.list({ status: 'planned', favorite: true })).resolves.toEqual(fixtures);
    expect(requests[0]?.url).toBe('https://api.trailhead.example/v1/trips?favorite=true&status=planned');
  });

  it('patches a trip and validates the returned record', async () => {
    const requests: Request[] = [];
    const updated = { ...fixtures[0], favorite: false };
    const trips = createTripRecordDataSource({ fetch: serve(200, updated, requests) });
    await expect(trips.update('trip-lakeside', { favorite: false })).resolves.toEqual(updated);
    expect(requests[0]?.method).toBe('PATCH');
    expect(await requests[0]?.json()).toEqual({ favorite: false });
  });

  it('rejects unknown fields and reports HTTP failures with their status', async () => {
    const trips = createTripRecordDataSource({ fetch: serve(404, {}) });
    await expect(trips.get('trip-missing')).rejects.toMatchObject({ status: 404 });
    await expect(trips.get('trip-missing')).rejects.toBeInstanceOf(TripRecordDataSourceError);
    await expect(trips.update('trip-lakeside', { colour: 'green' } as never)).rejects.toThrow();
  });
});
