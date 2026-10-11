import { describe, expect, it } from 'vitest';
import { testHost } from '../support/core-plugins.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { Registry, type CommandContext, type Plugin, type PluginContext, type PluginManifest } from '../../src/application/plugins/registry.ts';
import { registerCorePlugins, registrySkills, type CorePlugin } from '../../src/application/plugins/core-plugins.ts';
import { AppError } from '../../src/domain/shared/errors.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { skillsPlugin } from '../../src/plugins/skills/plugin.ts';
import { reviewOptions } from '../../src/application/generation/controls.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';

const manifest = (id: string): PluginManifest => ({ id, name: id, version: '1.0.0', minAppVersion: '0.1.0', description: 'Platform test', author: 'Test' });
const setup = () => {
  const registry = new Registry(skillFrontmatter), events = new EventBus(new NodeEventScope());
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

  it('orders optional services like required ones when a provider is enabled and reports their absence through has', async () => {
    const { registry, events } = setup(), order: string[] = [];
    let available: boolean[] = [];
    registry.register({ manifest: manifest('backlog'), optional: ['sync.hub', 'other.hub'], onload(context) { order.push('backlog'); available = [context.services.has('sync.hub'), context.services.has('other.hub')]; } }, events);
    registry.register({ manifest: manifest('sync'), provides: { 'sync.hub': {} }, onload() { order.push('sync'); } }, events);
    await registry.activate(events, context);
    expect(order).toEqual(['sync', 'backlog']);
    expect(available).toEqual([true, false]);
    const pluginContext = registry.pluginContext(registry.plugins[0]!, context, events);
    expect(() => pluginContext.services.get('other.hub')).toThrow(expect.objectContaining({ code: 'PLUGIN_SERVICE_MISSING', details: { plugin: 'backlog', service: 'other.hub' } }));
    expect(() => pluginContext.services.has('undeclared.hub')).toThrow(expect.objectContaining({ code: 'PLUGIN_SERVICE_MISSING' }));
    expect(() => setup().registry.register({ manifest: manifest('bad'), optional: ['Not An Id'] }, events)).toThrow(expect.objectContaining({ code: 'INVALID_PLUGIN', message: 'optional must list service ids.' }));
    await registry.dispose(events);
  });

  it('keeps a core plugin whose optional service provider is disabled', () => {
    const { registry, events } = setup();
    const core = (id: string, contributions: Partial<Plugin> = {}): CorePlugin => ({ manifest: { ...manifest(id), core: true }, create: () => contributions });
    registerCorePlugins(registry, events, [core('hub', { provides: { 'hub.api': {} } }), core('user', { optional: ['hub.api'] })], testHost({ skills: registrySkills(registry), fileDates: unusedFileDates }), ['hub']);
    expect(registry.plugins.map(plugin => plugin.manifest.id)).toEqual(['user']);
    expect(registry.disabled.map(plugin => plugin.id)).toEqual(['hub']);
  });

  it('rejects service ids outside the provider\'s namespace, for core plugins too, so providers never collide', () => {
    const { registry, events } = setup();
    registry.register({ manifest: manifest('alpha'), provides: { 'alpha.api': {} } }, events);
    // A service id names its provider, which lets the host attribute a missing service to a disabled core plugin.
    for (const provides of [{ catalog: {} }, { 'alpha.api': {} }]) {
      expect(() => registry.register({ manifest: { ...manifest('beta'), core: true }, provides }, events, 'core')).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    }
    expect(() => registry.register({ manifest: manifest('beta'), provides: { 'alpha.api': {} } }, events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    expect(() => registry.register({ manifest: manifest('gamma'), provides: { catalog: {} } }, events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    expect(registry.plugins.map(plugin => plugin.manifest.id)).toEqual(['alpha']);
  });
});

describe('plugin generators', () => {
  it('lets generators declare option names independently but reserves the options make owns', () => {
    const { registry, events } = setup();
    registry.add(registry.generators, { id: 'ui', description: 'UI', options: { framework: { type: 'string', description: 'Target' } }, run: () => null });
    for (const owned of ['out', 'plan', 'plan-out', 'check', 'revisions-from']) {
      expect(() => registry.register({ manifest: manifest('quality'), generators: [{ id: 'quality.page', description: 'Page', options: { [owned]: { type: 'boolean', description: 'Flag' } }, generate: () => [] }] }, events))
        .toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE', message: expect.stringContaining(`cannot declare --${owned}`) }));
    }
    expect(() => registry.register({ manifest: manifest('quality'), generators: [{ id: 'quality.page', description: 'Page', generate: () => [], run: () => null }] }, events)).toThrow(expect.objectContaining({ code: 'INVALID_PLUGIN' }));
    // Each generator parses only its own options, so another generator's --framework may be a boolean.
    registry.register({ manifest: manifest('quality'), generators: [{ id: 'quality.page', description: 'Page', options: { framework: { type: 'boolean', description: 'Flag' } }, review: true, generate: () => [] }] }, events);
    expect(registry.generators.get('quality.page')).toMatchObject({ review: true });
  });

  it('lets only a reviewed generator place the host review controls among its options', () => {
    const { registry, events } = setup();
    const generator = (id: string, review: boolean, options: Record<string, { type: 'string' | 'boolean'; description: string }>) => ({ id, description: 'Page', review, options, generate: () => [] });
    registry.register({ manifest: manifest('quality'), generators: [generator('quality.page', true, { project: { type: 'string', description: 'P' }, ...reviewOptions, tone: { type: 'string', description: 'T' } })] }, events);
    expect(Object.keys(registry.generators.get('quality.page')!.options!)).toEqual(['project', 'revisions-from', 'plan', 'plan-out', 'check', 'tone']);
    for (const [id, review, options] of [['audit.page', false, reviewOptions], ['audit.copy', true, { ...reviewOptions, plan: { ...reviewOptions.plan } }]] as const) {
      expect(() => registry.register({ manifest: manifest(id.split('.')[0]!), generators: [generator(id, review, options)] }, events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    }
  });
});

describe('plugin config sections', () => {
  const settings = { type: 'object', additionalProperties: false, properties: { threshold: { type: 'integer', minimum: 1, default: 3 }, label: { type: 'string' } } } as const;

  it('validates sections, fills defaults, leaves unloaded plugins alone and hands plugins their settings', async () => {
    const { registry, events } = setup();
    let received: unknown;
    registry.register({ manifest: manifest('quality'), settings, onload(context) { received = context.settings; } }, events);
    registry.register({ manifest: manifest('plain') }, events);
    const effective = await registry.configure({ quality: { label: 'Docs' }, removed: { kept: true } }, async () => ['removed'], message => { throw new Error(message); });
    expect(effective).toEqual({ quality: { threshold: 3, label: 'Docs' }, removed: { kept: true } });
    expect(registry.settings.sections()).toEqual([{ plugin: 'quality', path: 'plugins.settings.quality', schema: settings }]);
    expect(registry.settings.canonical('quality')).toBe('{"label":"Docs","threshold":3}');
    expect(registry.settings.canonical('plain')).toBeNull();
    await registry.activate(events, context);
    expect(received).toEqual({ threshold: 3, label: 'Docs' });
  });

  it('reports every invalid value with its config path on the unavailable plugin and warns about sections without settings', async () => {
    const { registry, events } = setup();
    registry.register({ manifest: manifest('quality'), settings, commands: [{ id: 'quality.run', description: 'Run', usage: 'quality.run', run: () => 'ran' }] }, events);
    registry.register({ manifest: manifest('plain') }, events);
    const warnings: string[] = [];
    expect(await registry.configure({ quality: { threshold: 0, extra: true }, plain: {} }, async () => [], message => warnings.push(message))).toEqual({ quality: { threshold: 0, extra: true }, plain: {} });
    expect(warnings).toEqual([
      expect.stringContaining('Plugin quality is unavailable in this invocation: plugins.settings.quality is invalid'),
      'plugins.settings has sections for plugins that declare no settings: plain; they are ignored.',
    ]);
    await expect(registry.commands.get('quality.run')!.run([], {}, context)).rejects.toMatchObject({
      code: 'PLUGIN_UNAVAILABLE', details: { command: 'quality.run', plugin: 'quality', issues: ['plugins.settings.quality.threshold: must be at least 1', 'plugins.settings.quality.extra: is not allowed'] },
    });
  });

  it('rejects settings schemas outside the supported JSON Schema subset', () => {
    const { registry, events } = setup();
    expect(() => registry.register({ manifest: manifest('quality'), settings: { type: 'object', anyOf: [] } as never }, events)).toThrow(expect.objectContaining({ code: 'INVALID_PLUGIN', message: expect.stringContaining('unsupported keyword anyOf') }));
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

  it('maps only codes the throwing plugin registered, or built-in codes; another plugin\'s code stays opaque', async () => {
    const { registry, events } = setup();
    registry.register(localized, events);
    const thrower = (code: string) => ({ id: `audit.${code.toLowerCase().replaceAll('_', '-')}`, description: 'Throw', usage: 'audit', run() { throw Object.assign(new Error(`Raised ${code}.`), { code, details: { by: 'audit' } }); } });
    registry.register({ manifest: manifest('audit'), commands: [thrower('QUALITY_UNOWNED'), thrower('NOT_FOUND')] }, events);
    const failure = (id: string) => Promise.resolve(registry.commands.get(id)!.run([], {}, context)).catch((error: unknown) => error);
    const borrowed = await failure('audit.quality-unowned');
    expect(borrowed).not.toBeInstanceOf(AppError);
    expect(new Localizer('en', registry.catalog).error(borrowed)).toMatchObject({ code: 'OPERATION_FAILED', message: 'Raised QUALITY_UNOWNED.' });
    expect(await failure('audit.not-found')).toMatchObject({ code: 'NOT_FOUND', exitCode: 3, details: { by: 'audit' } });
    expect(await failure('quality.check')).toMatchObject({ code: 'QUALITY_UNOWNED', exitCode: 5 });
  });

  it('maps a code of a plugin that provides a service the thrower declares, since its failures surface through the consumer', async () => {
    const { registry, events } = setup();
    const fail = () => { throw Object.assign(new Error('Owners unknown.'), { code: 'QUALITY_UNOWNED' }); };
    registry.register({ ...localized, provides: { 'quality.owners': { check: fail } } }, events);
    const consumer = (id: string, key: 'requires' | 'optional') => ({
      manifest: manifest(id), [key]: ['quality.owners'],
      commands: [{ id: `${id}.run`, description: 'Run', usage: `${id}.run`, run: (_args: string[], _flags: unknown, pluginContext: PluginContext) => pluginContext.services.get<{ check(): void }>('quality.owners').check() }],
    });
    registry.register(consumer('board', 'requires'), events);
    registry.register(consumer('report', 'optional'), events);
    for (const id of ['board.run', 'report.run']) {
      await expect(Promise.resolve(registry.commands.get(id)!.run([], {}, context))).rejects.toMatchObject({ code: 'QUALITY_UNOWNED', exitCode: 5, message: 'Owners unknown.' });
    }
  });

  it('gives a user plugin error code to the plugin with the longest matching prefix, whatever the load order', () => {
    const error = (code: string) => ({ code, category: 'input' as const, summary: 'S', hint: 'H' });
    const outer = setup();
    outer.registry.register({ manifest: manifest('a'), errors: [error('A_B_X')] }, outer.events);
    expect(() => outer.registry.register({ manifest: manifest('a-b'), errors: [error('A_B_Y')] }, outer.events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE', message: expect.stringContaining('A_B_X of plugin a falls in the namespace A_B_ of plugin a-b') }));
    expect(outer.registry.plugins.map(plugin => plugin.manifest.id)).toEqual(['a']);
    const inner = setup();
    inner.registry.register({ manifest: manifest('a-b'), errors: [error('A_B_Y')] }, inner.events);
    expect(() => inner.registry.register({ manifest: manifest('a'), errors: [error('A_B_X')] }, inner.events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    inner.registry.register({ manifest: manifest('a'), errors: [error('A_X')] }, inner.events);
    expect(inner.registry.catalog.errors().map(entry => [entry.pluginId, entry.code])).toEqual([['a-b', 'A_B_Y'], ['a', 'A_X']]);
  });

  it.each([
    [{ errors: [{ code: 'UNOWNED', category: 'drift', summary: 'S', hint: 'H' }] }, 'PLUGIN_NAMESPACE'],
    [{ errors: [{ code: 'QUALITY_X', category: 'unknown', summary: 'S', hint: 'H' }] }, 'INVALID_PLUGIN'],
    [{ errors: [{ code: 'NOT_FOUND', category: 'input', summary: 'S', hint: 'H' }] }, 'PLUGIN_NAMESPACE'],
    [{ strings: { fr: {} } }, 'INVALID_PLUGIN'],
    [{ strings: { de: { commands: { 'other.run': 'Fremd' } } } }, 'PLUGIN_NAMESPACE'],
    [{ strings: { de: { actions: { 'other.run list': 'Fremd' } } } }, 'PLUGIN_NAMESPACE'],
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
    registerCorePlugins(registry, events, [core('search'), core('links')], testHost({ skills: registrySkills(registry), fileDates: unusedFileDates }), ['links']);
    expect([...registry.commands.keys()]).toEqual(['search']);
    expect(registry.origins.get('search')).toBe('core');
    expect(registry.disabled.map(entry => entry.id)).toEqual(['links']);
    expect(() => registry.register({ manifest: manifest('links') }, events)).toThrow(expect.objectContaining({ code: 'DUPLICATE_PLUGIN' }));
  });

  it('ignores unknown ids in plugins.disabled with a warning and rejects core claims from user plugins', () => {
    const { registry, events } = setup();
    registerCorePlugins(registry, events, [core('search')], testHost({ skills: registrySkills(registry), fileDates: unusedFileDates }), ['serach']);
    expect([...registry.commands.keys()]).toEqual(['search']);
    expect(events.warnings).toEqual([expect.stringContaining('ignored serach')]);
    expect(() => registry.register({ manifest: { ...manifest('quality'), core: true } }, events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    expect(() => registry.register({ manifest: manifest('search') }, events, 'core')).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    expect(() => registry.register({ manifest: manifest('quality'), commands: [{ id: 'check', description: 'Bare', usage: 'check', run: () => null }] }, events)).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
  });

  it('keeps core plugin events in their own namespace', () => {
    const { registry, events } = setup();
    const event = { id: 'indexed', validate: (value: unknown): value is object => typeof value === 'object' };
    expect(() => registerCorePlugins(registry, events, [core('search', { events: [event] })], testHost({ skills: registrySkills(registry), fileDates: unusedFileDates }), [])).toThrow(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
  });

  it('migrates the skills command and bundled skills into the skills core plugin with German strings', async () => {
    const { registry, events } = setup();
    registerCorePlugins(registry, events, [skillsPlugin], testHost({ skills: registrySkills(registry), fileDates: unusedFileDates }), []);
    registry.register({ manifest: manifest('quality'), skills: [{ id: 'quality-review', content: '---\nname: quality-review\ndescription: Review. Use before merging.\n---\nReview.\n' }] }, events);
    expect([...registry.skills.keys()]).toEqual(['forge-workflow', 'forge-vault', 'forge-development', 'quality-review']);
    expect(await registry.commands.get('skills')!.run([], {}, context as PluginContext)).toEqual({ skills: ['forge-workflow', 'forge-vault', 'forge-development', 'quality-review'] });
    expect(new Localizer('de', registry.catalog).command(registry.commands.get('skills')!).description).toBe('Mitgelieferte und von Plugins bereitgestellte Agent-Skills auflisten, lesen oder installieren.');
    const disabled = setup();
    registerCorePlugins(disabled.registry, disabled.events, [skillsPlugin], testHost({ skills: registrySkills(disabled.registry), fileDates: unusedFileDates }), ['skills']);
    expect(disabled.registry.commands.has('skills')).toBe(false);
    expect(disabled.registry.skills.size).toBe(0);
  });
});
