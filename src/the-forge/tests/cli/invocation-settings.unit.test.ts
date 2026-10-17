import { describe, expect, it } from 'vitest';
import { bootstrapSettings, configuredSettings, flagSetting, requestedEvents, requestedLanguage } from '../../src/presentation/cli/invocation-settings.ts';
import { responseDocument } from '../../src/presentation/cli/response.ts';

const configured = { language: 'de', json: true, dryRun: true, events: 'all' } as const;

describe('invocation settings', () => {
  it('lets a negated flag win over its positive form, which wins over the configured value', () => {
    expect(flagSetting({}, 'dry-run', true)).toBe(true);
    expect(flagSetting({ 'dry-run': true }, 'dry-run', false)).toBe(true);
    expect(flagSetting({ 'no-dry-run': true }, 'dry-run', true)).toBe(false);
    expect(flagSetting({ 'no-dry-run': true, 'dry-run': true }, 'dry-run', true)).toBe(false);
  });

  it('formats from the --json or --no-json tokens before --, even when parsing the invocation fails', () => {
    expect(bootstrapSettings(['read', 'x.md', '--bogus', '--json'], {}).json).toBe(true);
    expect(bootstrapSettings(['read', '--', '--json'], {}).json).toBe(false);
    expect(configuredSettings(configured, bootstrapSettings(['read', '--no-json'], {}), ['read', '--no-json'], {}).json).toBe(false);
    expect(configuredSettings(configured, bootstrapSettings(['read', '--', '--no-json'], {}), ['read', '--', '--no-json'], {}).json).toBe(true);
  });

  it('applies a prefix --lang before the configuration and validates it at once', () => {
    expect(bootstrapSettings(['--lang', 'de', 'read'], { lang: 'de' }).language).toBe('de');
    expect(() => bootstrapSettings(['--lang', 'fr'], { lang: 'fr' })).toThrowError(expect.objectContaining({ code: 'INVALID_LANGUAGE' }));
    expect(requestedLanguage({}, 'de')).toBe('de');
    expect(requestedLanguage({ lang: 'en' }, 'de')).toBe('en');
  });

  it('keeps an invalid prefix --events for the complete parse to report, unless help describes the command', () => {
    expect(bootstrapSettings(['--events', 'bogus'], { events: 'bogus' }).events).toBe('changes');
    expect(bootstrapSettings(['--events', 'none'], { events: 'none' }).events).toBe('none');
    expect(() => requestedEvents({ events: 'bogus' }, 'changes')).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION_VALUE' }));
    expect(requestedEvents({ events: 'bogus', help: true }, 'all')).toBe('all');
    expect(requestedEvents({ events: 'none', help: true }, 'all')).toBe('none');
  });

  it('applies the bootstrap flags over the configured settings', () => {
    const prefix = { lang: 'en', 'no-dry-run': true, events: 'none' } as const;
    expect(configuredSettings(configured, bootstrapSettings(['--lang', 'en', '--no-dry-run', '--events', 'none'], prefix), [], prefix))
      .toEqual({ language: 'en', json: true, dryRun: false, events: 'none' });
    expect(configuredSettings(configured, bootstrapSettings([], {}), [], {})).toEqual(configured);
  });
});

describe('response document', () => {
  const invalid = () => ({ code: 'INVALID_RESULT', message: 'Not serializable.' });
  it('writes one compact or indented envelope with the context only once the scope is resolved', () => {
    const warnings = [{ code: 'PLUGIN_WARNING', message: 'w' }];
    const response = { result: { ok: true, data: { a: 1 } } as const, events: [], warnings };
    expect(responseDocument(response, true, invalid)).toEqual({ text: '{"ok":true,"data":{"a":1},"events":[],"warnings":[{"code":"PLUGIN_WARNING","message":"w"}]}\n', serializable: true });
    const context = { workspaceRoot: '/w', root: '/w', project: null };
    expect(responseDocument({ ...response, context }, false, invalid).text).toBe(`${JSON.stringify({ ok: true, data: { a: 1 }, context, events: [], warnings }, null, 2)}\n`);
  });
  it('replaces a result that cannot be serialized with the compact failure, keeping events and warnings', () => {
    const events = [{ id: 'vault.create', payload: { path: 'a.md' } }];
    const document = responseDocument({ result: { ok: true, data: { size: 1n } }, events, warnings: [] }, false, invalid);
    expect(document).toEqual({ text: `${JSON.stringify({ ok: false, error: invalid(), events, warnings: [] })}\n`, serializable: false });
  });
});
