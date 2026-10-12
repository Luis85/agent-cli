import { describe, expect, it } from 'vitest';
import { PluginSettings, type SettingsCheck } from '../../src/application/plugins/plugin-settings.ts';
import type { JsonSchema } from '../../src/domain/schema/json-schema.ts';

const schema: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    directory: { type: 'string', minLength: 1, default: 'agents' },
    model: { type: 'string', minLength: 1, default: 'sonnet/' },
  },
};

describe('plugin path settings', () => {
  it('normalizes declared path settings once, so config, the revision and the plugin see one value', () => {
    const settings = new PluginSettings();
    settings.declare('things', schema, { paths: ['directory'] });
    const report = settings.configure({ things: { directory: 'agents//' } }, new Set(['things']));
    expect(report.invalid.size).toBe(0);
    expect(report.effective.things).toEqual({ directory: 'agents', model: 'sonnet/' });
    expect(settings.value('things')).toEqual({ directory: 'agents', model: 'sonnet/' });
    const written = settings.canonical('things');
    settings.configure({ things: { directory: 'agents' } }, new Set(['things']));
    expect(settings.canonical('things')).toBe(written);
  });

  it.each(['../outside', '/absolute', 'a//b', '.'])('rejects a path setting that leaves the workspace: %s', directory => {
    const settings = new PluginSettings();
    settings.declare('things', schema, { paths: ['directory'] });
    const report = settings.configure({ things: { directory } }, new Set(['things']));
    expect(report.invalid.get('things')).toEqual(['plugins.settings.things.directory: must be a contained workspace-relative path']);
    expect(settings.value('things')).toBeNull();
  });

  it('names every escaping path setting and leaves other settings as written', () => {
    const settings = new PluginSettings();
    settings.declare('things', schema, { paths: ['directory', 'model'] });
    expect(settings.configure({ things: { directory: '../escape', model: '/absolute' } }, new Set(['things'])).invalid.get('things')).toEqual([
      'plugins.settings.things.directory: must be a contained workspace-relative path',
      'plugins.settings.things.model: must be a contained workspace-relative path',
    ]);
    const plain = new PluginSettings();
    plain.declare('things', schema);
    expect(plain.configure({ things: { directory: 'agents/' } }, new Set(['things'])).effective.things).toEqual({ directory: 'agents/', model: 'sonnet/' });
  });

  it('runs the plugin check on the normalized section', () => {
    const settings = new PluginSettings();
    const seen: unknown[] = [];
    settings.declare('things', schema, { paths: ['directory'], check: section => { seen.push(section.directory); return []; } });
    settings.configure({ things: { directory: 'agents/' } }, new Set(['things']));
    expect(seen).toEqual(['agents']);
  });
});


describe('plugin settings validation isolation', () => {
  it.each([
    ['throws', (): unknown => { throw new Error('invalid expression'); }, 'validateSettings failed: invalid expression'],
    ['returns a string', (): unknown => 'issue', 'validateSettings must return an array'],
    ['returns nothing', (): unknown => undefined, 'validateSettings must return an array'],
    ['returns empty issues', (): unknown => [''], 'validateSettings must return an array'],
    ['returns non-string issues', (): unknown => [null], 'validateSettings must return an array'],
    // A sparse array models malformed JavaScript plugin output; a filled array would miss this case.
    // oxlint-disable-next-line unicorn/no-new-array
    ['returns a sparse array', (): unknown => new Array(1), 'validateSettings must return an array'],
    ['returns a promise', async () => [], 'validateSettings must return an array'],
    ['rejects a promise', async () => { throw new Error('rejected'); }, 'validateSettings must return an array'],
  ] as const)('isolates a validator that %s and keeps other sections usable', (_label, check, diagnostic) => {
    const settings = new PluginSettings();
    settings.declare('broken', schema, { check: check as SettingsCheck });
    settings.declare('healthy', schema);
    const report = settings.configure({ broken: { directory: 'kept' } }, new Set(['broken', 'healthy']));
    expect(report.invalid.get('broken')).toEqual([expect.stringContaining(`plugins.settings.broken: ${diagnostic}`)]);
    expect(report.effective.broken).toEqual({ directory: 'kept' });
    expect(settings.value('broken')).toBeNull();
    expect(settings.value('healthy')).toEqual({ directory: 'agents', model: 'sonnet/' });
  });

  it('forgets a previous effective value when the section becomes invalid', () => {
    const settings = new PluginSettings();
    settings.declare('things', schema, { paths: ['directory'] });
    settings.configure({ things: {} }, new Set(['things']));
    expect(settings.value('things')).not.toBeNull();
    settings.configure({ things: { directory: '../outside' } }, new Set(['things']));
    expect(settings.value('things')).toBeNull();
    expect(settings.canonical('things')).toBeNull();
  });
});
