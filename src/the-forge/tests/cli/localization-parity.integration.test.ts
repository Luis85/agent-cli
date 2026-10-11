import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/infrastructure/workspace/config.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { germanKernelMessages } from '../../src/presentation/localization/messages.ts';
import { kernelMessages, type KernelMessageCode } from '../../src/domain/shared/kernel-messages.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { commands } from '../../src/presentation/cli/commands.ts';
import { globalOptionMetadata } from '../../src/presentation/cli/arguments.ts';
import { Registry, type Command } from '../../src/application/plugins/registry.ts';
import type { WorkflowServices } from '../../src/presentation/cli/services.ts';
import { registerCorePlugins, registrySkills } from '../../src/application/plugins/core-plugins.ts';
import { basesPlugin } from '../../src/plugins/bases/plugin.ts';
import { skillsPlugin } from '../../src/plugins/skills/plugin.ts';
import { searchPlugin } from '../../src/plugins/search/plugin.ts';
import { linksPlugin } from '../../src/plugins/links/plugin.ts';
import { vaultCheckPlugin } from '../../src/plugins/vault-check/plugin.ts';
import { agentsPlugin } from '../../src/plugins/agents/plugin.ts';
import { backlogPlugin } from '../../src/plugins/backlog/plugin.ts';
import { templatesPlugin } from '../../src/plugins/templates/plugin.ts';
import { scaffoldsPlugin } from '../../src/plugins/scaffolds/plugin.ts';
import { uiPlugin } from '../../src/plugins/ui/plugin.ts';
import { dataSourcesPlugin } from '../../src/plugins/data-sources/plugin.ts';
import { claudePlugin } from '../../src/plugins/claude/plugin.ts';
import { connectorPlugin } from '../../src/plugins/connector/plugin.ts';
import { azureDevOpsPlugin } from '../../src/plugins/connector-azure-devops/plugin.ts';
import { bundledCorePlugins, offlineHost, testHost } from '../support/core-plugins.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';

/**
 * The localization policy as a regression gate: every human-facing text that kernel and core plugin metadata
 * declare has a German translation that differs from the English text. A new option, argument, setting, plugin
 * message or kernel warning without German fails here, with the untranslated texts listed.
 */
const corePlugins = [
  templatesPlugin, scaffoldsPlugin, uiPlugin, dataSourcesPlugin, claudePlugin,
  basesPlugin, skillsPlugin, searchPlugin, linksPlugin, vaultCheckPlugin, agentsPlugin, connectorPlugin, azureDevOpsPlugin, backlogPlugin,
];
let root: string;
let registry: Registry;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-locale-parity-'));
  const loaded = await loadConfig({ defaultPath: join(root, 'bin/config.json'), cwd: root });
  const services: WorkflowServices = {
    loaded,
    get files(): never { throw new Error('Catalog must not access files'); },
    get projects(): never { throw new Error('Catalog must not access projects'); },
    get workflows(): never { throw new Error('Catalog must not access workflows'); },
    async setup() { throw new Error('Catalog must not run setup'); },
    configSections: () => registry.settings.sections(),
    async installedPlugins() { return []; },
  };
  registry = new Registry(skillFrontmatter);
  const bus = new EventBus(new NodeEventScope());
  registerHostEvents(bus);
  for (const command of commands(registry, services)) registry.add(registry.commands, command);
  expect(corePlugins.map(plugin => plugin.manifest.id)).toEqual([...bundledCorePlugins]);
  registerCorePlugins(registry, bus, corePlugins, testHost({ skills: registrySkills(registry), fileDates: () => { throw new Error('Catalog must not read files'); }, ...offlineHost }), []);
  await registry.configure({}, async () => [], () => undefined);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

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
