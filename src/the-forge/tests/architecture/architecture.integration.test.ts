import { expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { boundaryViolations, compositionViolations, sdkViolations } from './import-boundaries.ts';

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

it('keeps concern folders within their layer boundaries and separates adapters', async () => {
  const violations: string[] = [];
  for (const layer of ['domain', 'application', 'infrastructure', 'presentation']) {
    for (const file of await sourceFiles(resolve('src', layer))) {
      violations.push(...boundaryViolations(file, await readFile(file, 'utf8')));
    }
  }
  expect(violations).toEqual([]);
});

it('keeps every core plugin within its own layers, kernel ports and domain contracts', async () => {
  const files = await sourceFiles(resolve('src/plugins'));
  expect(files.length).toBeGreaterThan(0);
  const violations: string[] = [];
  for (const file of files) violations.push(...boundaryViolations(file, await readFile(file, 'utf8')));
  expect(violations).toEqual([]);
});

it('reaches core plugins from the composition root only through their plugin.ts factories', async () => {
  const file = resolve('src/main.ts');
  expect(compositionViolations(file, await readFile(file, 'utf8'))).toEqual([]);
});

it('keeps the packaged SDK type-only and inward-facing', async () => {
  const file = resolve('src/sdk.ts');
  expect(sdkViolations(file, await readFile(file, 'utf8'))).toEqual([]);
});
