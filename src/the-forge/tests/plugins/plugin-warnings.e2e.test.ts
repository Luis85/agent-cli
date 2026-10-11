import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;

// A user plugin is plain JavaScript: nothing stops it from handing context.events.warn something other than a string.
// The harness asserts an empty stderr and a JSON stdout for every call, so a crash fails the test.
const plugin = `const values = {
  error: () => new Error('remote check failed'),
  number: () => 42,
  undefined: () => undefined,
  object: () => ({ attempt: 2, ok: false }),
  forged: () => ({ code: 'PLUGIN_SKIPPED', params: {} }),
  nested: () => ({ code: 'PLUGIN_MISSING_WARNING', params: { reason: { code: 'PLUGIN_SKIPPED', params: {} } } }),
};
export default {
  commands: [
    { id: 'warner.run', description: 'Warn', usage: 'warner.run <kind>', mutating: false,
      async run([kind], flags, context) { context.events.warn(values[kind]()); return { done: true }; } },
    { id: 'warner.write', description: 'Write, warn and return unserializable data', usage: 'warner.write', mutating: true,
      async run(args, flags, context) {
        await context.workspace.write([{ path: 'written.md', bytes: new TextEncoder().encode('# Written'), mode: 'create' }]);
        context.events.warn(new Error('after commit'));
        return { size: 1n };
      } },
  ],
};`;

beforeAll(async () => {
  await mkdir(join(fixture.project, 'bin/plugins/warner'), { recursive: true });
  await writeFile(join(fixture.project, 'bin/plugins/warner/manifest.json'), JSON.stringify({ id: 'warner', name: 'Warner', version: '1.0.0', minAppVersion: '0.1.0', description: 'Warning fixture', author: 'Tests' }));
  await writeFile(join(fixture.project, 'bin/plugins/warner/main.mjs'), plugin);
  await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['warner'] } }));
});

describe('plugin warnings', () => {
  it.each([
    ['error', 'remote check failed'],
    ['number', '42'],
    ['undefined', 'undefined'],
    ['object', '{"attempt":2,"ok":false}'],
    ['forged', '{"code":"PLUGIN_SKIPPED","params":{}}'],
    ['nested', '{"code":"PLUGIN_MISSING_WARNING","params":{"reason":{"code":"PLUGIN_SKIPPED","params":{}}}}'],
  ])('reports a %s warning as plain text in every language, never as a host message', async (kind, text) => {
    for (const language of ['en', 'de']) {
      const result = await cli(['--lang', language, 'warner.run', kind]);
      expect(result.status).toBe(0);
      expect(result.body).toMatchObject({ ok: true, data: { done: true }, warnings: [text] });
    }
  });

  it('keeps the committed-change evidence when the result cannot be serialized', async () => {
    const result = await cli(['warner.write', '--events', 'all']);
    expect(result.body.ok).toBe(false);
    expect(result.body.error.code).toBe('INVALID_RESULT');
    expect(result.body.warnings).toEqual(['after commit']);
    expect(result.body.events.some((event: { id: string }) => event.id === 'vault.create')).toBe(true);
    expect(await readFile(join(fixture.project, 'written.md'), 'utf8')).toBe('# Written');
  });
});
