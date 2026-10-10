import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { Registry, type CommandContext, type Plugin, type PluginContext, type PluginManifest } from '../../src/application/plugins/registry.ts';
import { registerCorePlugins, registrySkills, type CorePlugin } from '../../src/application/plugins/core-plugins.ts';
import { AppError } from '../../src/domain/shared/errors.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { skillsPlugin } from '../../src/plugins/skills/plugin.ts';
import { offlineHost } from '../support/core-plugins.ts';

const manifest = (id: string): PluginManifest => ({ id, name: id, version: '1.0.0', minAppVersion: '0.1.0', description: 'Platform test', author: 'Test' });
const setup = () => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  return { registry, events };
};
const context = { language: 'en' } as unknown as CommandContext;
const unusedFileDates = (): never => { throw new Error('Platform tests do not read file dates'); };

describe('plugin services', () => {
  it('activates providers before the plugins that require their services and hands out declared services only', async () => {
    const { registry, events } = setup(), order: string[] = [];
    let seen: unknown;
    registry.register({ manifest: manifest('ui'), requires: ['interactions.catalog'], onload(context) { order.push('ui'); seen = context.services.get<{ ids(): string[] }>('interactions.catalog').ids(); } }, events);
    registry.register({ manifest: manifest('interactions'), provides: { 'interactions.catalog': { ids: () => ['toggle'] } }, onload() { order.push('interactions'); } }, events);
    registry.register({ manifest: manifest('audit'), onload(context) { order.push('audit'); context.services.get('interactions.catalog'); } }, events);
    await expect(registry.activate(events, context)).rejects.toMatchObject({ code: 'PLUGIN_SERVICE_MISSING', details: { plugin: 'audit', service: 'interactions.catalog' } });
    expect(order).toEqual(['interactions', 'ui', 'audit']);
    expect(seen).toEqual(['toggle']);
    await registry.dispose(events);
  });

  it('fails activation clearly when a required service has no provider or services form a cycle', async () => {
    const missing = setup();
    missing.registry.register({ manifest: manifest('ui'), requires: ['interactions.catalog'], onload() { throw new Error('never activated'); } }, missing.events);
    await expect(missing.registry.activate(missing.events, context)).rejects.toMatchObject({ code: 'PLUGIN_SERVICE_MISSING', message: expect.stringContaining('requires service interactions.catalog') });
    const cyclic = setup();
    cyclic.registry.register({ manifest: manifest('alpha'), provides: { 'alpha.api': {} }, requires: ['beta.api'] }, cyclic.events);
    cyclic.registry.register({ manifest: manifest('beta'), provides: { 'beta.api': {} }, requires: ['alpha.api'] }, cyclic.events);
    await expect(cyclic.registry.activate(cyclic.events, context)).rejects.toMatchObject({ code: 'PLUGIN_SERVICE_CYCLE', details: { plugins: ['alpha', 'beta', 'alpha'] } });
  });

  it('rejects duplicate providers and service ids outside a user plugin namespace', () => {
    const { registry, events } = setup();
    registry.register({ manifest: manifest('alpha'), provides: { 'alpha.api': {} } }, events);
    // Only core plugins may provide bare or foreign service ids, so only they can collide.
    expect(() => registry.register({ manifest: { ...manifest('beta'), core: true }, provides: { catalog: {}, 'alpha.api': {} } }, events, 'core')).toThrow(expect.objectContaining({ code: 'DUPLICATE_OR_INVALID_ID' }));
    expect(() => registry.register({ manifest: manifest('beta'), provides: { 'alpha.api': {} } }, events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    expect(() => registry.register({ manifest: manifest('gamma'), provides: { catalog: {} } }, events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    expect(registry.plugins.map(plugin => plugin.manifest.id)).toEqual(['alpha']);
  });
});

describe('plugin generators', () => {
  it('keeps one type per make option across generators', () => {
    const { registry, events } = setup();
    registry.add(registry.generators, { id: 'ui', description: 'UI', options: { framework: { type: 'string', description: 'Target' } }, run: () => null });
    expect(() => registry.register({ manifest: manifest('quality'), generators: [{ id: 'quality.page', description: 'Page', options: { framework: { type: 'boolean', description: 'Flag' } }, generate: () => [] }] }, events))
      .toThrow(expect.objectContaining({ code: 'INVALID_PLUGIN', message: expect.stringContaining('--framework as boolean, but ui declares it as string') }));
    expect(() => registry.register({ manifest: manifest('quality'), generators: [{ id: 'quality.page', description: 'Page', generate: () => [], run: () => null }] }, events)).toThrow(expect.objectContaining({ code: 'INVALID_PLUGIN' }));
    registry.register({ manifest: manifest('quality'), generators: [{ id: 'quality.page', description: 'Page', options: { framework: { type: 'string', description: 'Target' } }, review: true, generate: () => [] }] }, events);
    expect(registry.generators.get('quality.page')).toMatchObject({ review: true });
  });
});

describe('plugin config sections', () => {
  const settings = { type: 'object', additionalProperties: false, properties: { threshold: { type: 'integer', minimum: 1, default: 3 }, label: { type: 'string' } } } as const;

  it('validates sections, fills defaults, leaves unloaded plugins alone and hands plugins their settings', async () => {
    const { registry, events } = setup();
    let received: unknown;
    registry.register({ manifest: manifest('quality'), settings, onload(context) { received = context.settings; } }, events);
    registry.register({ manifest: manifest('plain') }, events);
    const effective = registry.settings.configure({ quality: { label: 'Docs' }, removed: { kept: true } }, new Set(registry.origins.keys()));
    expect(effective).toEqual({ quality: { threshold: 3, label: 'Docs' }, removed: { kept: true } });
    expect(registry.settings.sections()).toEqual([{ plugin: 'quality', path: 'plugins.settings.quality', schema: settings }]);
    expect(registry.settings.canonical('quality')).toBe('{"label":"Docs","threshold":3}');
    expect(registry.settings.canonical('plain')).toBeNull();
    await registry.activate(events, context);
    expect(received).toEqual({ threshold: 3, label: 'Docs' });
  });

  it('reports every invalid value with its config path and rejects sections for plugins without settings', () => {
    const { registry, events } = setup();
    registry.register({ manifest: manifest('quality'), settings }, events);
    registry.register({ manifest: manifest('plain') }, events);
    expect(() => registry.settings.configure({ quality: { threshold: 0, extra: true }, plain: {} }, new Set(registry.origins.keys()))).toThrow(expect.objectContaining({
      code: 'INVALID_CONFIG',
      details: { issues: ['plugins.settings.plain: plugin plain declares no settings', 'plugins.settings.quality.threshold: must be at least 1', 'plugins.settings.quality.extra: is not allowed'] },
    }));
  });

  it('rejects settings schemas outside the supported JSON Schema subset', () => {
    const { registry, events } = setup();
    expect(() => registry.register({ manifest: manifest('quality'), settings: { type: 'object', oneOf: [] } as never }, events)).toThrow(expect.objectContaining({ code: 'INVALID_PLUGIN', message: expect.stringContaining('unsupported keyword oneOf') }));
    expect(() => registry.register({ manifest: manifest('quality'), settings: { type: 'string' } }, events)).toThrow(expect.objectContaining({ code: 'INVALID_PLUGIN' }));
  });
});

describe('plugin strings and error catalog', () => {
  const localized: Plugin = {
    manifest: manifest('quality'),
    commands: [{ id: 'quality.check', description: 'Check notes', usage: 'quality.check', mutating: false, run() { throw Object.assign(new Error('Two notes lack owners.'), { code: 'QUALITY_UNOWNED', details: { notes: 2 } }); } }],
    errors: [{ code: 'QUALITY_UNOWNED', category: 'drift', summary: 'Notes lack an owner.', hint: 'Add an owner property to each note.' }],
    strings: {
      en: { messages: { ready: 'Quality checks ready.' } },
      de: { commands: { 'quality.check': 'Notizen prüfen' }, errors: { QUALITY_UNOWNED: { summary: 'Notizen ohne Verantwortliche.', hint: 'Ergänzen Sie die Eigenschaft owner.' } }, messages: { ready: 'Qualitätsprüfungen bereit.' } },
    },
  };

  it('merges contributed German descriptions and turns registered codes into catalogued failures', async () => {
    const { registry, events } = setup();
    registry.register(localized, events);
    const german = new Localizer('de', registry.catalog);
    expect(german.command(registry.commands.get('quality.check')!).description).toBe('Notizen prüfen');
    const failure = await Promise.resolve(registry.commands.get('quality.check')!.run([], {}, context)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: 'QUALITY_UNOWNED', exitCode: 5, details: { notes: 2 } });
    expect(new Localizer('en', registry.catalog).error(failure)).toEqual({ code: 'QUALITY_UNOWNED', message: 'Two notes lack owners.', hint: 'Add an owner property to each note.', retryable: false, details: { notes: 2 } });
    expect(german.error(failure)).toMatchObject({ code: 'QUALITY_UNOWNED', message: 'Notizen ohne Verantwortliche.', hint: 'Ergänzen Sie die Eigenschaft owner.', details: { notes: 2, localization: { originalMessage: 'Two notes lack owners.' } } });
    expect(german.result('schema', { errors: [{ code: 'QUALITY_UNOWNED', summary: 'Notes lack an owner.' }] })).toEqual({ errors: [{ code: 'QUALITY_UNOWNED', summary: 'Notizen ohne Verantwortliche.' }] });
  });

  it('resolves plugin messages in the invocation language with an English fallback', () => {
    const { registry, events } = setup();
    registry.register(localized, events);
    const plugin = registry.plugins[0]!;
    const t = (language: 'en' | 'de') => registry.pluginContext(plugin, { language } as CommandContext, events).t;
    expect(t('de')('ready')).toBe('Qualitätsprüfungen bereit.');
    expect(t('en')('ready')).toBe('Quality checks ready.');
    expect(t('de')('missing')).toBe('missing');
  });

  it.each([
    [{ errors: [{ code: 'UNOWNED', category: 'drift', summary: 'S', hint: 'H' }] }, 'PLUGIN_NAMESPACE'],
    [{ errors: [{ code: 'QUALITY_X', category: 'unknown', summary: 'S', hint: 'H' }] }, 'INVALID_PLUGIN'],
    [{ errors: [{ code: 'NOT_FOUND', category: 'input', summary: 'S', hint: 'H' }] }, 'PLUGIN_NAMESPACE'],
    [{ strings: { fr: {} } }, 'INVALID_PLUGIN'],
    [{ strings: { de: { commands: { 'other.run': 'Fremd' } } } }, 'PLUGIN_NAMESPACE'],
    [{ strings: { de: { errors: { QUALITY_UNKNOWN: { summary: 'S', hint: 'H' } } } } }, 'PLUGIN_NAMESPACE'],
  ])('rejects invalid strings and error contributions %#', (contribution, code) => {
    const { registry, events } = setup();
    expect(() => registry.register({ manifest: manifest('quality'), ...contribution } as Plugin, events)).toThrow(expect.objectContaining({ code }));
  });
});

describe('core plugins', () => {
  const core = (id: string, extra: Partial<Plugin> = {}): CorePlugin => ({ manifest: { ...manifest(id), core: true }, create: () => ({ commands: [{ id, description: `${id} command`, usage: id, run: () => id }], ...extra }) });

  it('registers bundled plugins enabled by default with bare command ids and records disabled ones without contributions', () => {
    const { registry, events } = setup();
    registerCorePlugins(registry, events, [core('search'), core('links')], { skills: registrySkills(registry), fileDates: unusedFileDates, ...offlineHost }, ['links']);
    expect([...registry.commands.keys()]).toEqual(['search']);
    expect(registry.origins.get('search')).toBe('core');
    expect(registry.disabled.map(entry => entry.id)).toEqual(['links']);
    expect(() => registry.register({ manifest: manifest('links') }, events)).toThrow(expect.objectContaining({ code: 'DUPLICATE_PLUGIN' }));
  });

  it('rejects unknown ids in plugins.disabled and core claims from user plugins', () => {
    const { registry, events } = setup();
    expect(() => registerCorePlugins(registry, events, [core('search')], { skills: registrySkills(registry), fileDates: unusedFileDates, ...offlineHost }, ['quality'])).toThrow(expect.objectContaining({ code: 'INVALID_PLUGIN_CONFIG' }));
    expect(() => registry.register({ manifest: { ...manifest('quality'), core: true } }, events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    expect(() => registry.register({ manifest: manifest('search') }, events, 'core')).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    expect(() => registry.register({ manifest: manifest('quality'), commands: [{ id: 'check', description: 'Bare', usage: 'check', run: () => null }] }, events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
  });

  it('keeps core plugin events in their own namespace', () => {
    const { registry, events } = setup();
    const event = { id: 'indexed', validate: (value: unknown): value is object => typeof value === 'object' };
    expect(() => registerCorePlugins(registry, events, [core('search', { events: [event] })], { skills: registrySkills(registry), fileDates: unusedFileDates, ...offlineHost }, [])).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
  });

  it('migrates the skills command and bundled skills into the skills core plugin with German strings', async () => {
    const { registry, events } = setup();
    registerCorePlugins(registry, events, [skillsPlugin], { skills: registrySkills(registry), fileDates: unusedFileDates, ...offlineHost }, []);
    registry.register({ manifest: manifest('quality'), skills: [{ id: 'quality.review', content: 'Review.' }] }, events);
    expect([...registry.skills.keys()]).toEqual(['forge-workflow', 'forge-vault', 'forge-development', 'quality.review']);
    expect(await registry.commands.get('skills')!.run([], {}, context as PluginContext)).toEqual({ skills: ['forge-workflow', 'forge-vault', 'forge-development', 'quality.review'] });
    expect(new Localizer('de', registry.catalog).command(registry.commands.get('skills')!).description).toBe('Mitgelieferte und von Plugins bereitgestellte Agent-Skills auflisten, lesen oder installieren.');
    const disabled = setup();
    registerCorePlugins(disabled.registry, disabled.events, [skillsPlugin], { skills: registrySkills(disabled.registry), fileDates: unusedFileDates, ...offlineHost }, ['skills']);
    expect(disabled.registry.commands.has('skills')).toBe(false);
    expect(disabled.registry.skills.size).toBe(0);
  });
});
