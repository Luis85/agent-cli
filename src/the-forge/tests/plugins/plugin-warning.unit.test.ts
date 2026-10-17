import { describe, expect, it } from 'vitest';
import { pluginWarning } from '../../src/domain/shared/warnings.ts';

describe('a plugin warning record', () => {
  it('keeps its own code, text and JSON details', () => {
    expect(pluginWarning({ code: 'QUALITY_STALE', message: 'my text', details: { notes: ['a.md'] } }, 'quality'))
      .toEqual({ code: 'QUALITY_STALE', message: 'my text', details: { notes: ['a.md'], plugin: 'quality' } });
  });

  it.each([
    ['a host code', { code: 'PATH_MATCHED_NOTHING', message: 'my text' }, { requestedCode: 'PATH_MATCHED_NOTHING' }],
    ['a code that is not UPPER_SNAKE_CASE', { code: 'quality-stale', message: 'my text', details: { count: 2 } }, { count: 2, requestedCode: 'quality-stale' }],
    ['a code that is not text', { code: 7, message: 'my text' }, {}],
    ['text details', { code: 'QUALITY_STALE', message: 'my text', details: 'str' }, { requestedCode: 'QUALITY_STALE' }],
    ['list details', { code: 'QUALITY_STALE', message: 'my text', details: ['a'] }, { requestedCode: 'QUALITY_STALE' }],
    ['details holding a BigInt', { code: 'QUALITY_STALE', message: 'my text', details: { count: 10n } }, { requestedCode: 'QUALITY_STALE' }],
  ])('with %s reads PLUGIN_WARNING with the plugin\'s own text, never the record as JSON', (_label, value, details) => {
    expect(pluginWarning(value, 'quality')).toEqual({ code: 'PLUGIN_WARNING', message: 'my text', details: { ...details, plugin: 'quality' } });
  });

  it('still reports a record without a text message as its JSON text', () => {
    expect(pluginWarning({ code: 'QUALITY_STALE', message: 3 }, 'quality')).toEqual({ code: 'PLUGIN_WARNING', message: '{"code":"QUALITY_STALE","message":3}', details: { plugin: 'quality' } });
    expect(pluginWarning({ message: 'no code' })).toEqual({ code: 'PLUGIN_WARNING', message: '{"message":"no code"}' });
  });
});
