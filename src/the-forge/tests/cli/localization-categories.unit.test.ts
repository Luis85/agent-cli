import { describe, expect, it } from 'vitest';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { PluginCatalog } from '../../src/application/plugins/plugin-catalog.ts';
import { kernelMessage } from '../../src/domain/shared/kernel-messages.ts';
import { fill, retranslate } from '../../src/domain/shared/messages.ts';
import { globalOptionMetadata } from '../../src/presentation/cli/arguments.ts';
import { option } from '../../src/application/plugins/command-metadata.ts';

const read = {
  id: 'read', description: 'Read a document.', usage: 'read <path>',
  options: { parts: option.string('Comma-separated optional parts of a Markdown read.', { enum: ['body'] }) },
  args: [{ name: 'path', description: 'Vault path relative to the command scope.', required: true }],
};
const owned = { commands: ['quality'], actions: [], generators: [], events: [] };
function pluginCatalog() {
  const catalog = new PluginCatalog();
  const strings = { de: { manifest: { name: 'Qualität', description: 'Qualität prüfen.' }, descriptions: { 'Only failing checks.': 'Nur fehlgeschlagene Prüfungen.' } } };
  PluginCatalog.validate('quality', strings, undefined, owned, 'QUALITY_');
  catalog.add('quality', strings, undefined, 'QUALITY_');
  return catalog;
}

describe('German output by category', () => {
  it('translates option and argument descriptions and keeps names, types and enums', () => {
    const german = new Localizer('de').command(read);
    expect(german.options.parts).toEqual({ type: 'string', enum: ['body'], description: 'Kommagetrennte optionale Teile eines Markdown-Lesevorgangs.' });
    expect(german.args).toEqual([{ name: 'path', required: true, description: 'Vault-Pfad relativ zum Geltungsbereich des Befehls.' }]);
    expect(new Localizer('en').command(read)).toBe(read);
  });

  it('translates global option descriptions in help and schema', () => {
    const help = new Localizer('de').result('help', { globalOptions: globalOptionMetadata }) as { globalOptions: typeof globalOptionMetadata };
    expect(help.globalOptions.lang).toEqual({ ...globalOptionMetadata.lang, description: 'Antwortsprache für Beschreibungen, Hinweise und Zusammenfassungen.' });
  });

  it('translates plugin option and settings descriptions by their English text', () => {
    const localizer = new Localizer('de', pluginCatalog());
    const command = localizer.command({ id: 'quality', description: 'Check quality.', options: { failing: option.boolean('Only failing checks.') } });
    expect(command.options.failing.description).toBe('Nur fehlgeschlagene Prüfungen.');
    const sections = [{ plugin: 'quality', path: 'plugins.settings.quality', schema: { type: 'object', properties: { failing: { type: 'boolean', description: 'Only failing checks.' }, other: { type: 'string', description: 'Untranslated.' } } } }];
    expect(localizer.result('config', { sections })).toEqual({ sections: [{ ...sections[0], schema: { type: 'object', properties: { failing: { type: 'boolean', description: 'Nur fehlgeschlagene Prüfungen.' }, other: { type: 'string', description: 'Untranslated.' } } } }] });
  });

  it('renders host warnings and plugin state reasons in the response language, keeping plugin warnings', () => {
    const warning = kernelMessage('PLUGIN_UNAVAILABLE', { plugin: 'backlog', reason: kernelMessage('PLUGIN_PROVIDER_DISABLED', { service: 'bases.query', provider: 'bases' }) });
    expect(new Localizer('en').warning(warning)).toBe('Plugin backlog is unavailable in this invocation: Requires service bases.query; its provider bases is disabled. Its commands and generators fail with PLUGIN_UNAVAILABLE; fix bin/config.json and run config.');
    expect(new Localizer('de').warning(warning)).toBe('Das Plugin backlog ist in diesem Aufruf nicht verfügbar: Benötigt den Dienst bases.query; sein Anbieter bases ist deaktiviert. Seine Befehle und Generatoren schlagen mit PLUGIN_UNAVAILABLE fehl; korrigieren Sie bin/config.json und führen Sie config aus.');
    expect(new Localizer('de').warning(kernelMessage('EVENT_LISTENER_FAILED', { event: 'vault.create', diagnostic: 'boom' }))).toBe('Der Listener für vault.create ist fehlgeschlagen: boom');
    expect(new Localizer('de').warning('Plugin-owned text')).toBe('Plugin-owned text');
  });

  it('renders only messages the host created from its catalog, and any other record as text', () => {
    const german = new Localizer('de');
    expect(german.warning(kernelMessage('PLUGIN_SKIPPED'))).toBe('Durch --no-plugins übersprungen.');
    expect(german.warning({ code: 'PLUGIN_SKIPPED', params: {} })).toBe('{"code":"PLUGIN_SKIPPED","params":{}}');
    expect(german.warning(kernelMessage('PLUGIN_MISSING_WARNING', { reason: { code: 'PLUGIN_SKIPPED', params: {} } as never }))).toBe('{"code":"PLUGIN_SKIPPED","params":{}} Seine Befehle sind in diesem Aufruf nicht verfügbar.');
    for (const record of [new Error('raw'), null, undefined, { code: 'PLUGIN_MISSING_WARNING', params: null }, 42]) expect(() => german.warning(record)).not.toThrow();
    const message = kernelMessage('EVENT_LISTENER_FAILED', { event: 'vault.create', diagnostic: 'boom' });
    expect(() => Object.assign(message.params, { event: null })).toThrow(TypeError);
  });

  it('lists plugin names and descriptions in the response language', () => {
    const manifest = { id: 'quality', name: 'Quality', description: 'Check quality.', version: '1.0.0' };
    expect(new Localizer('de', pluginCatalog()).manifest(manifest)).toEqual({ ...manifest, name: 'Qualität', description: 'Qualität prüfen.' });
    expect(new Localizer('en', pluginCatalog()).manifest(manifest)).toBe(manifest);
    expect(new Localizer('de', pluginCatalog()).manifest({ ...manifest, id: 'other' })).toEqual({ ...manifest, id: 'other' });
  });
});

describe('message templates', () => {
  const english = { cycle: '{title} closes a parent loop.', tie: '{count} items share rank {rank}; ties follow result order.' };
  const german = { cycle: '{title} schließt eine Elternschleife.', tie: '{count} Einträge teilen sich Rang {rank}; Gleichstände folgen der Ergebnisreihenfolge.' };

  it('fills placeholders verbatim and leaves unknown ones', () => {
    expect(fill('{a} and {b} cost $&', { a: '$1', b: 2 })).toBe('$1 and 2 cost $&');
    expect(fill('{missing}', {})).toBe('{missing}');
  });

  it('renders an English message in another language from the template that produced it', () => {
    expect(retranslate(fill(english.tie, { count: 3, rank: 'a0' }), english, german)).toBe('3 Einträge teilen sich Rang a0; Gleichstände folgen der Ergebnisreihenfolge.');
    expect(retranslate(fill(english.cycle, { title: 'Plan (v2) [draft]' }), english, german)).toBe('Plan (v2) [draft] schließt eine Elternschleife.');
    expect(retranslate('A third-party parser message.', english, german)).toBe('A third-party parser message.');
  });
});
