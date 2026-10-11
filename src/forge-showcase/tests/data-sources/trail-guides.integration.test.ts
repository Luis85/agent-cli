import { readFile } from 'node:fs/promises';
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
