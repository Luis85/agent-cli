/**
 * Behavioral tests authored into the showcase project. They run with the
 * project's own Vitest toolchain (`npm test` from src/forge-showcase) and
 * exercise generated code that has no generator-supplied tests.
 */
export const projectTests = {
  'tests/trips/trip-model.domain.unit.test.ts': `import { describe, expect, it } from 'vitest';
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
`,
  'tests/trips/share-itinerary.application.unit.test.ts': `import { describe, expect, it, vi } from 'vitest';
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
`,
  'tests/data-sources/trips-api.integration.test.ts': `import { readFile } from 'node:fs/promises';
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
`,
  'tests/data-sources/trail-guides.integration.test.ts': `import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createTrailGuideDataSource } from '../../src/infrastructure/data-sources/trail-guides.ts';

const projectRoot = new URL('../../', import.meta.url);
const guides = createTrailGuideDataSource({
  loadJson: async path => JSON.parse(await readFile(new URL(path, projectRoot), 'utf8')),
});

describe('trail-guides local JSON adapter', () => {
  it('lists the bundled guides from the deterministic fixture', async () => {
    const list = await guides.list();
    expect(list.map(guide => guide.id)).toEqual(['guide-desolation', 'guide-skyline', 'guide-pfeiffer', 'guide-joshua']);
    expect(list.filter(guide => guide.dogFriendly).map(guide => guide.name)).toEqual(['Pfeiffer Falls']);
  });

  it('finds one guide and reports a missing guide as 404', async () => {
    await expect(guides.get('guide-skyline')).resolves.toMatchObject({ region: 'cascades', difficulty: 'moderate' });
    await expect(guides.get('guide-unknown')).rejects.toMatchObject({ status: 404 });
  });
});
`,
  'tests/vault/knowledge-graph.integration.test.ts': `import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const skipped = new Set(['node_modules', 'dist', 'demo-dist', 'coverage']);

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || skipped.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [relative(root, path).split('\\\\').join('/')];
  });
}

const files = walk(root);
const notes = files.filter(path => path.endsWith('.md'));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Obsidian resolves a link by vault path or by unique file name; Markdown names may omit .md. */
function targets(link: string): string[] {
  const names = [link, link + '.md'];
  return files.filter(path => names.includes(path) || names.includes(basename(path)));
}

function wikilinks(text: string): string[] {
  const prose = text.replace(/\\x60\\x60\\x60[\\s\\S]*?\\x60\\x60\\x60/g, '').replace(/\\x60[^\\x60\\n]*\\x60/g, '');
  return [...prose.matchAll(/!?\\[\\[([^\\]|#]+)(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]/g)].map(match => (match[1] ?? '').trim());
}

describe('Trailhead knowledge graph', () => {
  it('resolves every wikilink to exactly one vault file', () => {
    const broken = notes.flatMap(note => wikilinks(read(note))
      .filter(link => targets(link).length !== 1)
      .map(link => note + ' -> ' + link));
    expect(broken).toEqual([]);
  });

  it('links every workflow document back to the PRD', () => {
    const documents = notes.filter(path => path.startsWith('docs/') && /^stage: /m.test(read(path)) && !path.endsWith('Trailhead PRD.md'));
    expect(documents.length).toBeGreaterThanOrEqual(7);
    expect(documents.filter(path => !wikilinks(read(path)).includes('Trailhead PRD'))).toEqual([]);
  });

  it('keeps canvas file nodes and edges connected to existing files', () => {
    for (const canvas of files.filter(path => path.endsWith('.canvas'))) {
      const graph = JSON.parse(read(canvas)) as { nodes: { id: string; type: string; file?: string }[]; edges: { fromNode: string; toNode: string }[] };
      const ids = new Set(graph.nodes.map(node => node.id));
      expect(graph.nodes.filter(node => node.type === 'file' && !files.includes(node.file ?? '')).map(node => node.file)).toEqual([]);
      expect(graph.edges.filter(edge => !ids.has(edge.fromNode) || !ids.has(edge.toNode))).toEqual([]);
    }
  });
});
`,
};
