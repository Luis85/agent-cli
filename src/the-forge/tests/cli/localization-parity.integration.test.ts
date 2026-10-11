import { beforeAll, describe, expect, it } from 'vitest';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { germanKernelMessages } from '../../src/presentation/localization/messages.ts';
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

/** Every option and argument description of a command and its actions, keyed by where it is declared. */
function described(command: Pick<Command, 'id' | 'options' | 'args' | 'actions'>): Map<string, string> {
  const texts = new Map<string, string>();
  for (const [name, option] of Object.entries(command.options ?? {})) texts.set(`${command.id} --${name}`, option.description);
  for (const argument of command.args ?? []) texts.set(`${command.id} <${argument.name}>`, argument.description);
  for (const [action, definition] of Object.entries(command.actions ?? {})) {
    for (const [name, option] of Object.entries(definition.options ?? {})) texts.set(`${command.id} ${action} --${name}`, option.description);
  }
  return texts;
}
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
    const german = new Localizer('de', registry.catalog).result('help', { globalOptions: globalOptionMetadata, generators: [] }) as { globalOptions: typeof globalOptionMetadata };
    const texts = (options: typeof globalOptionMetadata) => new Map(Object.entries(options).map(([name, option]) => [name, option.description]));
    expect(untranslated(texts(globalOptionMetadata), texts(german.globalOptions))).toEqual([]);
  });

  it('translates every plugin settings description that config reports', () => {
    const sections = registry.settings.sections();
    expect(sections.length).toBeGreaterThanOrEqual(9);
    const german = new Localizer('de', registry.catalog).result('config', { sections }) as { sections: typeof sections };
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

  it('gives every kernel warning and plugin state reason a German text with the same placeholders', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const code of Object.keys(kernelMessages) as KernelMessageCode[]) {
      expect(germanKernelMessages[code], code).not.toBe(kernelMessages[code]);
      expect(placeholders(germanKernelMessages[code]), code).toEqual(placeholders(kernelMessages[code]));
    }
  });
});
