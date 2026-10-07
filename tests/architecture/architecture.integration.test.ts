import { expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
it('keeps domain and application dependencies pointing inward', async () => {
  for (const layer of ['domain', 'application']) {
    for (const name of await readdir(resolve('src', layer))) {
      const text = await readFile(resolve('src', layer, name), 'utf8');
      const imports = [...text.matchAll(/(?:from\s+|import\s*\()["']([^"']+)/g)].map(m => m[1]!);
      for (const path of imports) {
        expect(path).not.toMatch(/node:|infrastructure|presentation/);
        if (layer === 'domain') expect(path).not.toContain('application');
        expect(path.startsWith('.')).toBe(true);
      }
    }
  }
});
