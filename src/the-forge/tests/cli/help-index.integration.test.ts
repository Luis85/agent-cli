import { beforeAll, describe, expect, it } from 'vitest';
import type { Command, CommandContext, Registry } from '../../src/application/plugins/registry.ts';
import { helpIndexBudget, indexDescription, indexDescriptionLength, shortestIndexDescription } from '../../src/presentation/cli/help-index.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { fullRegistry } from '../support/full-registry.ts';

/** The compact help index of every kernel and core plugin command, in English and German, under its byte budget. */
let registry: Registry, english: Command[];
beforeAll(async () => { registry = await fullRegistry(); english = [...registry.commands.values()]; });

const context = {} as CommandContext;
/** The help index in `language`, of the registered commands and `added` ones, each localized from English. */
async function index(language: 'en' | 'de', added: readonly Command[] = []) {
  const localizer = new Localizer(language, registry.catalog);
  registry.commands.clear();
  for (const command of [...english, ...added]) registry.commands.set(command.id, localizer.command(command));
  const help = registry.commands.get('help')!;
  return { data: localizer.result(help, await help.run([], {}, context)) as { commands: Record<string, string> }, describe: (id: string) => help.run([id], {}, context) as Promise<{ description: string }> };
}

describe('help index', () => {
  it('stays within 4 KB of compact JSON in both languages and lists every command with a short description', async () => {
    for (const language of ['en', 'de'] as const) {
      const { data, describe } = await index(language);
      expect(Buffer.byteLength(JSON.stringify(data)), language).toBeLessThanOrEqual(helpIndexBudget);
      expect(helpIndexBudget).toBe(4096);
      expect(Object.keys(data.commands)).toEqual([...registry.commands.keys()]);
      for (const [id, description] of Object.entries(data.commands)) {
        expect(description.length, `${language} ${id}`).toBeLessThanOrEqual(indexDescriptionLength);
        // help <command> keeps the whole description, which begins with the index text up to its cut.
        const full = (await describe(id)).description;
        expect(full.startsWith(description.replace(/[.…]$/, '')), `${language} ${id}`).toBe(true);
      }
    }
  });

  it('shortens every description instead of outgrowing the budget when commands are added, as user plugins do', async () => {
    const full = (await index('en')).data.commands;
    const template = english.find(command => command.id === 'list')!;
    const description = 'Synchronize the configured work items with the remote tracker and report every change it would make.';
    const added = Array.from({ length: 20 }, (_, number) => ({ ...template, id: `extra-${number + 1}.sync`, description }));
    for (const language of ['en', 'de'] as const) {
      const { data, describe } = await index(language, added);
      expect(Buffer.byteLength(JSON.stringify(data)), language).toBeLessThanOrEqual(helpIndexBudget);
      expect(Object.keys(data.commands)).toEqual([...english, ...added].map(command => command.id));
      const lengths = Object.values(data.commands).map(text => text.length);
      expect(Math.max(...lengths), language).toBeLessThan(indexDescriptionLength);
      expect(Math.max(...lengths), language).toBeGreaterThanOrEqual(shortestIndexDescription);
      for (const [id, text] of Object.entries(data.commands)) expect((await describe(id)).description.startsWith(text.replace(/[.…]$/, '')), `${language} ${id}`).toBe(true);
    }
    // Without the added commands the index keeps its full-length descriptions.
    expect((await index('en')).data.commands).toEqual(full);
    expect(Math.max(...Object.values(full).map(text => text.length))).toBe(indexDescriptionLength);
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
    expect(indexDescription(sentence, 30)).toBe('Search text files for a…');
  });
});
