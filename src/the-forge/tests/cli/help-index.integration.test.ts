import { beforeAll, describe, expect, it } from 'vitest';
import type { CommandContext, Registry } from '../../src/application/plugins/registry.ts';
import { indexDescription, indexDescriptionLength } from '../../src/presentation/cli/catalog-commands.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { fullRegistry } from '../support/full-registry.ts';

/** The compact help index of every kernel and core plugin command, in English and German, under its byte budget. */
let registry: Registry;
beforeAll(async () => { registry = await fullRegistry(); });

const context = {} as CommandContext;
async function index(language: 'en' | 'de') {
  const localizer = new Localizer(language, registry.catalog);
  for (const [id, command] of registry.commands) registry.commands.set(id, localizer.command(command));
  const help = registry.commands.get('help')!;
  return { data: localizer.result(help, await help.run([], {}, context)) as { commands: Record<string, string> }, describe: (id: string) => help.run([id], {}, context) as Promise<{ description: string }> };
}

describe('help index', () => {
  it('stays within 4 KB of compact JSON in both languages and lists every command with a short description', async () => {
    for (const language of ['en', 'de'] as const) {
      const { data, describe } = await index(language);
      expect(Buffer.byteLength(JSON.stringify(data)), language).toBeLessThanOrEqual(4096);
      expect(Object.keys(data.commands)).toEqual([...registry.commands.keys()]);
      for (const [id, description] of Object.entries(data.commands)) {
        expect(description.length, `${language} ${id}`).toBeLessThanOrEqual(indexDescriptionLength);
        // help <command> keeps the whole description, which begins with the index text up to its cut.
        const full = (await describe(id)).description;
        expect(full.startsWith(description.replace(/[.…]$/, '')), `${language} ${id}`).toBe(true);
      }
    }
  });

  it('shows the first sentence, shortened at a word boundary only when it is too long', () => {
    expect(indexDescription('Read a note. Long content is truncated.')).toBe('Read a note.');
    expect(indexDescription('List files; skip symlinks.')).toBe('List files.');
    expect(indexDescription('Inspect plugins.settings.connector.connections and test them.')).toBe('Inspect plugins.settings.connector.connections and test them.');
    expect(indexDescription('No final period')).toBe('No final period');
    const sentence = 'Search text files for a literal or regular-expression pattern and return hits with line, column and snippet.';
    const long = indexDescription(sentence);
    expect(long).toMatch(/^Search text files for a literal .*[a-z]…$/);
    expect(long.length).toBeLessThanOrEqual(indexDescriptionLength);
    expect(sentence.startsWith(`${long.slice(0, -1)} `)).toBe(true);
  });
});
