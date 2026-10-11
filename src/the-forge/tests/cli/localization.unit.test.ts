import { describe, expect, it } from 'vitest';
import { testHost } from '../support/core-plugins.ts';
import { AppError } from '../../src/domain/shared/errors.ts';
import { language, Localizer } from '../../src/presentation/localization/localization.ts';
import { PluginCatalog } from '../../src/application/plugins/plugin-catalog.ts';
import { scaffoldsPlugin } from '../../src/plugins/scaffolds/plugin.ts';

describe('presentation localization', () => {
  it('selects explicit supported languages and rejects unsupported values', () => {
    expect(language('en')).toBe('en');
    expect(language('de')).toBe('de');
    for (const value of ['fr', 'DE', '', 'de-DE', 'constructor']) expect(() => language(value)).toThrow(/Unsupported language/);
  });
  it('keeps the English protocol unchanged', () => {
    const localizer = new Localizer();
    const command = { id: 'read', description: 'Read document', usage: 'read <path>' };
    const result = { path: 'hello.md', content: 'The text is German: Hallo' };
    expect(localizer.command(command)).toBe(command);
    expect(localizer.result('read', result)).toBe(result);
    expect(localizer.error(new AppError('CONFLICT', 'Original conflict', 2, { revision: '123' }))).toEqual({ code: 'CONFLICT', message: 'Original conflict', hint: expect.stringContaining('--if-match'), retryable: false, details: { revision: '123' } });
  });
  it('preserves diagnostics and existing error details without mutating them', () => {
    const localizer = new Localizer('de');
    const details = { outputs: [{ path: 'src/ui.ts', status: 'changed' }], diagnostic: 'custom', localization: { custom: true } };
    const output = localizer.error(new AppError('UI_DRIFT', 'Review src/ui.ts with --plan.', 5, details));
    expect(output.code).toBe('UI_DRIFT');
    expect(output.message).toContain('Generierte UI-Dateien');
    expect(output.details).toEqual({ ...details, localization: { originalMessage: 'Review src/ui.ts with --plan.', originalDetails: { custom: true } } });
    expect(details.localization).toEqual({ custom: true });
  });
  it('leaves plugin messages, document content and generated output unchanged', () => {
    const localizer = new Localizer('de');
    const plugin = { id: 'example.read', description: 'Plugin text', usage: 'example.read' };
    expect(localizer.command(plugin)).toBe(plugin);
    expect(localizer.error(new AppError('PLUGIN_CUSTOM', 'Plugin-owned diagnostic'))).toEqual({ code: 'PLUGIN_CUSTOM', message: 'Plugin-owned diagnostic' });
    const data = { description: 'Author content', generators: [{ id: 'example.custom', description: 'Owned by plugin' }], content: 'hello', path: 'original.md' };
    expect(localizer.result('example.read', data)).toBe(data);
    expect(localizer.result('read', data)).toBe(data);
    expect(localizer.result('make', { preview: [{ path: 'src/read.ts', content: 'const message = "Read";' }] })).toEqual({ preview: [{ path: 'src/read.ts', content: 'const message = "Read";' }] });
    expect(localizer.result('make', data)).toEqual(data);
  });
  it('localizes guidance by known command and preserves authored library descriptions', () => {
    const localizer = new Localizer('de');
    const nextSteps = [{ command: 'node bin/forge.js project list', purpose: 'Find a project' }, { command: 'custom', purpose: 'Preserve me' }];
    expect(localizer.result('setup', { nextSteps })).toEqual({ nextSteps: [{ command: nextSteps[0]!.command, purpose: expect.stringContaining('Ein Projekt suchen') }, nextSteps[1]] });
    const data = { status: 'empty', directory: 'my sources', nextStep: 'Initialize', description: 'Author-owned text' };
    // Library guidance belongs to the core plugins that own those commands (localizedLibraryResult); the kernel leaves it alone.
    expect(localizer.result('data-sources', data)).toBe(data);
    const formats = localizer.result('formats', { text: ['ts'], textFiles: 'UTF-8 read', attachments: 'Bytes', otherFiles: 'Opaque' });
    expect(formats).toMatchObject({ text: ['ts'], textFiles: expect.stringContaining('UTF-8 lesen'), attachments: expect.stringContaining('verlustfrei') });
    expect(localizer.result('events', { delivery: 'English' })).toEqual({ delivery: expect.stringContaining('--events none|changes|all') });
    const contracts = [{ id: 'vault.create', description: 'English' }, { id: 'quality.checked', description: 'Plugin text' }, { id: 'quality.bare' }];
    expect(localizer.result('events', { contracts, delivery: 'English' })).toEqual({ delivery: expect.stringContaining('vault.*'), contracts: [
      { id: 'vault.create', description: expect.stringContaining('Ordner') }, contracts[1], contracts[2],
    ] });
    expect(localizer.result('schema', { errors: [], generators: [], eventOutput: { option: '--events', changes: 'English' } })).toMatchObject({ eventOutput: { option: '--events', changes: expect.stringContaining('vault.rename') } });
  });
  it('translates known metadata without changing machine identifiers or usage', () => {
    // Generator descriptions come from the plugin that contributes the generator (here scaffolds' entity).
    const catalog = new PluginCatalog();
    catalog.add('scaffolds', scaffoldsPlugin.create(testHost({ skills: { list: () => [], get: () => undefined }, fileDates: () => () => Promise.reject(new Error('unused')) })).strings, undefined);
    const localizer = new Localizer('de', catalog);
    expect(localizer.command({ id: 'read', description: 'Read', usage: 'read <path>' })).toEqual({ id: 'read', description: expect.stringContaining('lesen'), usage: 'read <path>' });
    expect(localizer.result('make', { generators: [{ id: 'entity', description: 'Entity' }] })).toEqual({ generators: [{ id: 'entity', description: expect.stringContaining('Domain-Entität') }] });
    expect(localizer.command({ id: 'constructor', description: 'Original' }).description).toBe('Original');
  });
});
