import { expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * German texts use one term per concept, as `docs/reference/language.md` lists: the product's own nouns Vault and
 * Workspace stay untranslated, so a hint never names a "Tresor" or an "Arbeitsbereich" that no other text mentions.
 * The banned words occur in no English identifier, so the whole source tree is scanned, plugins included.
 */
const banned = [/tresor/i, /arbeitsbereich/i];

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries.filter(entry => entry.isFile() && entry.name.endsWith('.ts')).map(entry => join(entry.parentPath, entry.name));
}

it('keeps the German glossary: Vault and Workspace, never Tresor or Arbeitsbereich', async () => {
  const findings: string[] = [];
  for (const path of await sources('src')) {
    (await readFile(path, 'utf8')).split('\n').forEach((line, index) => {
      for (const term of banned) if (term.test(line)) findings.push(`${path}:${index + 1}: ${term.source}`);
    });
  }
  expect(findings).toEqual([]);
});
