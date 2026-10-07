import { expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { boundaryViolations } from './import-boundaries.ts';

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

it('keeps every domain and application dependency pointing inward', async () => {
  const violations: string[] = [];
  for (const layer of ['domain', 'application']) {
    for (const file of await sourceFiles(resolve('src', layer))) {
      violations.push(...boundaryViolations(file, await readFile(file, 'utf8')));
    }
  }
  expect(violations).toEqual([]);
});
