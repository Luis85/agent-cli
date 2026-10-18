import { beforeAll, describe, expect, it } from 'vitest';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { germanKernelMessages } from '../../src/presentation/localization/messages.ts';
import { germanDescriptions } from '../../src/presentation/localization/descriptions.ts';
import { germanActions, germanCommands, germanGuidance } from '../../src/presentation/localization/catalog.ts';
import { readFile } from 'node:fs/promises';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { kernelMessages, type KernelMessageCode } from '../../src/domain/shared/kernel-messages.ts';
import { globalOptionMetadata } from '../../src/presentation/cli/arguments.ts';
import type { Command, Registry } from '../../src/application/plugins/registry.ts';
import { bundledCorePlugins } from '../support/core-plugins.ts';
import { corePlugins, fullRegistry } from '../support/full-registry.ts';

/**
 * The localization policy as a regression gate: every human-facing text that kernel and core plugin metadata
 * declare has a German translation that differs from the English text. A new option, argument, setting, plugin
 * message or kernel warning without German fails here, with the untranslated texts listed.
 */
let registry: Registry;
beforeAll(async () => {
  expect(corePlugins.map(plugin => plugin.manifest.id)).toEqual([...bundledCorePlugins]);
  registry = await fullRegistry();
});

/** Every `description` inside a JSON Schema, keyed by its JSON path. */
function schemaDescriptions(value: unknown, path: string, texts = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) value.forEach((item, index) => schemaDescriptions(item, `${path}/${index}`, texts));
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'description' && typeof item === 'string') texts.set(path, item);
      else schemaDescriptions(item, `${path}/${key}`, texts);
    }
  }
  return texts;
}
/**
 * Every option and argument description of a command and its actions, keyed by where it is declared, including the
 * descriptions inside the JSON document schema an option or argument declares (`edit --edits`, the `apply` plan).
 */
function described(command: Pick<Command, 'id' | 'options' | 'args' | 'actions'>): Map<string, string> {
  const texts = new Map<string, string>();
  const add = (key: string, item: { description: string; schema?: unknown }) => {
    texts.set(key, item.description);
    schemaDescriptions(item.schema, `${key} schema`, texts);
  };
  for (const [name, option] of Object.entries(command.options ?? {})) add(`${command.id} --${name}`, option);
  for (const argument of command.args ?? []) add(`${command.id} <${argument.name}>`, argument);
  for (const [action, definition] of Object.entries(command.actions ?? {})) {
    for (const [name, option] of Object.entries(definition.options ?? {})) add(`${command.id} ${action} --${name}`, option);
    for (const argument of definition.args ?? []) add(`${command.id} ${action} <${argument.name}>`, argument);
  }
  return texts;
}
/** The entries whose German text is missing or still the English text. */
function untranslated(english: Map<string, string>, german: Map<string, string>): string[] {
  return [...english].filter(([key, text]) => !german.get(key) || german.get(key) === text).map(([key, text]) => `${key}: ${text}`);
}

describe('German localization parity', () => {
  it('translates every option and argument description of every command and generator', () => {
    const localizer = new Localizer('de', registry.catalog);
    const missing = [...registry.commands.values()].flatMap(command => untranslated(described(command), described(localizer.command(command))));
    expect(missing).toEqual([]);
    expect([...registry.commands.values()].reduce((count, command) => count + described(command).size, 0)).toBeGreaterThan(250);
  });

  it('translates every global option description', () => {
    const german = new Localizer('de', registry.catalog).result(registry.commands.get('help'), { globalOptions: globalOptionMetadata, generators: [] }) as { globalOptions: typeof globalOptionMetadata };
    const texts = (options: typeof globalOptionMetadata) => new Map(Object.entries(options).map(([name, option]) => [name, option.description]));
    expect(untranslated(texts(globalOptionMetadata), texts(german.globalOptions))).toEqual([]);
  });

  it('translates every plugin settings description that config reports', () => {
    const sections = registry.settings.sections();
    expect(sections.length).toBeGreaterThanOrEqual(9);
    const german = new Localizer('de', registry.catalog).result(registry.commands.get('config'), { sections }) as { sections: typeof sections };
    const texts = (entries: typeof sections) => new Map(entries.flatMap(section => [...schemaDescriptions(section.schema, section.path)]));
    expect(untranslated(texts(sections), texts(german.sections))).toEqual([]);
  });

  it('translates the name and description of every core plugin, enabled or disabled', () => {
    for (const plugin of corePlugins) {
      for (const field of ['name', 'description'] as const) {
        expect(registry.catalog.manifest(plugin.manifest.id, 'de')?.[field], `${plugin.manifest.id} ${field}`).toEqual(expect.any(String));
        expect(registry.catalog.manifest(plugin.manifest.id, 'de')?.[field], `${plugin.manifest.id} ${field}`).not.toBe(plugin.manifest[field]);
      }
    }
  });

  it('gives every English plugin message a German message', () => {
    for (const plugin of registry.plugins) {
      const english = Object.keys(plugin.strings?.en?.messages ?? {}), german = plugin.strings?.de?.messages ?? {};
      expect(english.filter(key => !Object.hasOwn(german, key)), plugin.manifest.id).toEqual([]);
    }
  });

  it('keeps no German text whose English source nothing declares any more', () => {
    const declared = new Set([
      ...[...registry.commands.values()].flatMap(command => [...described(command).values()]),
      ...Object.values(globalOptionMetadata).map(option => option.description),
      ...registry.settings.sections().flatMap(section => [...schemaDescriptions(section.schema, section.path).values()]),
    ]);
    const stale = (table: Record<string, string> | undefined) => Object.keys(table ?? {}).filter(text => !declared.has(text));
    expect(stale(germanDescriptions)).toEqual([]);
    for (const plugin of registry.plugins) expect(stale(plugin.strings?.de?.descriptions), plugin.manifest.id).toEqual([]);
    expect(Object.keys(germanCommands).filter(id => !registry.commands.has(id))).toEqual([]);
    expect(Object.keys(germanActions).filter(key => {
      const [command, action] = key.split(' ') as [string, string];
      return registry.commands.get(command)?.actions?.[action] === undefined;
    })).toEqual([]);
  });

  it('translates every guidance text of the result fields discovery commands declare as text, and keeps no stale guidance', async () => {
    const events = new EventBus(new NodeEventScope());
    registerHostEvents(events);
    const context = { events } as unknown as CommandContext;
    const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : value !== null && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
    const texts = new Set<string>();
    for (const [id, args] of [['help', []], ['schema', []], ['schema', ['read']], ['formats', []], ['events', []]] as const) {
      const command = registry.commands.get(id)!, data = await command.run([...args], {}, context) as Record<string, unknown>;
      for (const [field, kind] of Object.entries(command.localizedOutput ?? {})) if (kind === 'text') for (const text of strings(data[field])) texts.add(text);
    }
    expect(texts.size).toBeGreaterThanOrEqual(7);
    // Of the eventOutput and setup step fields, only the explanatory sentences are guidance.
    const sentences = [...texts].filter(text => text.includes(' '));
    expect(sentences.filter(text => !germanGuidance[text] || germanGuidance[text] === text)).toEqual([]);
    // setup's next steps come from a run that writes files; its purposes are declared in the setup service.
    const setup = await readFile('src/application/workspace/setup.ts', 'utf8');
    expect(Object.keys(germanGuidance).filter(text => !texts.has(text) && !setup.includes(`purpose: '${text}'`))).toEqual([]);
  });

  it('gives every kernel warning and plugin state reason a German text with the same placeholders', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const code of Object.keys(kernelMessages) as KernelMessageCode[]) {
      expect(germanKernelMessages[code], code).not.toBe(kernelMessages[code]);
      expect(placeholders(germanKernelMessages[code]), code).toEqual(placeholders(kernelMessages[code]));
    }
  });
});
