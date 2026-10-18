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
  return { data: localizer.result(help, await help.run([], {}, context)) as { commands: Record<string, string>; omitted?: number; next: string }, describe: (id: string) => help.run([id], {}, context) as Promise<{ description: string }> };
}

describe('help index', () => {
  it('stays within 4 KB of compact JSON in both languages and lists every command with a short description', async () => {
    for (const language of ['en', 'de'] as const) {
      const { data, describe } = await index(language);
      expect(Buffer.byteLength(JSON.stringify(data)), language).toBeLessThanOrEqual(helpIndexBudget);
      expect(helpIndexBudget).toBe(4096);
      expect(Object.keys(data.commands)).toEqual([...registry.commands.keys()]);
      expect(data).not.toHaveProperty('omitted');
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
      expect(data, language).not.toHaveProperty('omitted');
      for (const [id, text] of Object.entries(data.commands)) expect((await describe(id)).description.startsWith(text.replace(/[.…]$/, '')), `${language} ${id}`).toBe(true);
    }
    // Without the added commands the index keeps its full-length descriptions.
    expect((await index('en')).data.commands).toEqual(full);
    expect(Math.max(...Object.values(full).map(text => text.length))).toBe(indexDescriptionLength);
  });

  /** `count` commands like `list` with the ids `id(number)` and a long description, as many user plugins add. */
  const extra = (count: number, id: (number: number) => string) => {
    const template = english.find(command => command.id === 'list')!;
    const description = 'Synchronize the configured work items with the remote tracker and report every change it would make.';
    return Array.from({ length: count }, (_, number) => ({ ...template, id: id(number + 1), description }));
  };

  it('keeps descriptions for the leading commands only and counts the omitted ones when even the shortest cut outgrows the budget', async () => {
    const added = extra(150, number => `p${number}.sync`);
    const ids = [...english, ...added].map(command => command.id);
    // The budget reserves room for the longest translation of next, which the response translates after the index.
    const nexts = [(await index('en')).data.next, (await index('de')).data.next];
    const next = nexts.reduce((longest, text) => Buffer.byteLength(text) > Buffer.byteLength(longest) ? text : longest);
    for (const language of ['en', 'de'] as const) {
      const { data, describe } = await index(language, added);
      expect(Buffer.byteLength(JSON.stringify(data)), language).toBeLessThanOrEqual(helpIndexBudget);
      expect(Object.keys(data.commands), language).toEqual(ids);
      // The described commands lead in registry order, cut at the shortest length; the rest are empty and counted.
      const texts = Object.values(data.commands), described = texts.findIndex(text => text === '');
      expect(described, language).toBeGreaterThan(0);
      expect(texts.slice(described).every(text => text === ''), language).toBe(true);
      expect(data.omitted, language).toBe(ids.length - described);
      for (const [id, text] of Object.entries(data.commands).slice(0, described)) {
        expect(text.length, `${language} ${id}`).toBeLessThanOrEqual(shortestIndexDescription);
        expect((await describe(id)).description.startsWith(text.replace(/[.…]$/, '')), `${language} ${id}`).toBe(true);
      }
      // One more description would not fit with the longest next.
      const first = ids[described]!, more = { ...data, commands: { ...data.commands, [first]: indexDescription((await describe(first)).description, shortestIndexDescription) }, omitted: data.omitted! - 1, next };
      expect(Buffer.byteLength(JSON.stringify(more)), language).toBeGreaterThan(helpIndexBudget);
    }
  });

  it('lists every command id with an empty description when the ids alone outgrow the budget, since discovery takes precedence', async () => {
    const added = extra(400, number => `user-plugin-${number}.synchronize-tracker`);
    const ids = [...english, ...added].map(command => command.id);
    for (const language of ['en', 'de'] as const) {
      const { data } = await index(language, added);
      expect(Object.keys(data.commands), language).toEqual(ids);
      expect(Object.values(data.commands).every(text => text === ''), language).toBe(true);
      expect(data.omitted, language).toBe(ids.length);
      expect(Buffer.byteLength(JSON.stringify(data)), language).toBeGreaterThan(helpIndexBudget);
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
    expect(indexDescription(sentence, 30)).toBe('Search text files for a…');
  });
});
