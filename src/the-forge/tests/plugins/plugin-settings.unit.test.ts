import { describe, expect, it } from 'vitest';
import { PluginSettings } from '../../src/application/plugins/plugin-settings.ts';
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
