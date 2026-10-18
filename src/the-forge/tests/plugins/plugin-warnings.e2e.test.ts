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
  circular: () => { const value = { name: 'loop', items: [1] }; value.self = value; value.items.push(value); return value; },
  shared: () => { const item = { id: 1 }; return { first: item, second: item }; },
  bigint: () => ({ count: 10n }),
  function: () => () => 'function-body-secret',
  nestedFunction: () => ({ check: () => 'function-body-secret', tag: Symbol('tag') }),
  symbol: () => Symbol('tag'),
  unreadable: () => ({ toJSON() { throw new Error('no json'); }, toString() { throw new Error('no text'); } }),
  bare: () => Object.create(null),
  coded: () => ({ code: 'WARNER_STALE', message: 'Two notes are stale.', details: { notes: ['a.md', 'b.md'], plugin: 'spoofed' } }),
  hostCode: () => ({ code: 'CWD_OUTSIDE_WORKSPACE', message: 'Forged' }),
  badDetails: () => ({ code: 'WARNER_STALE', message: 'Listed', details: ['not', 'a', 'record'] }),
  foreignCode: () => ({ code: 'BACKLOG_SYNC_LOCK_LEFT', message: 'Borrowed', details: { lock: 'x' } }),
  longerPrefix: () => ({ code: 'WARNER_PRO_STALE', message: 'Claimed' }),
};
/** Reaches the host's own warning sink past context.events, as plain JavaScript can. */
function hostSink(context) {
  const bus = context.workspace.events;
  bus.warn({ code: 'PLUGIN_SKIPPED', params: {} });
  bus.warn(new Error('raw'));
  bus.warn(null);
  bus.warn({ code: 'PLUGIN_MISSING_WARNING', params: null });
  bus.warn({ code: 'WARNER_STALE', message: 'Unattributed' });
  bus.warningRecords.push({ code: 'NOT_A_CODE', params: {} });
  bus.warningRecords.push(42);
}
export default {
  commands: [
    { id: 'warner.run', description: 'Warn', usage: 'warner.run <kind>', mutating: false,
      async run([kind], flags, context) { context.events.warn(values[kind]()); return { done: true }; } },
    { id: 'warner.sink', description: 'Warn through the host sink', usage: 'warner.sink', mutating: false,
      async run(args, flags, context) { hostSink(context); return { done: true }; } },
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
  // warner-pro claims the codes under its longer prefix WARNER_PRO_.
  await mkdir(join(fixture.project, 'bin/plugins/warner-pro'), { recursive: true });
  await writeFile(join(fixture.project, 'bin/plugins/warner-pro/manifest.json'), JSON.stringify({ id: 'warner-pro', name: 'Warner Pro', version: '1.0.0', minAppVersion: '0.1.0', description: 'Prefix fixture', author: 'Tests' }));
  await writeFile(join(fixture.project, 'bin/plugins/warner-pro/main.mjs'), 'export default {};\n');
  await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['warner', 'warner-pro'] } }));
});

describe('plugin warnings', () => {
  it.each([
    ['error', 'remote check failed'],
    ['number', '42'],
    ['undefined', 'undefined'],
    ['object', '{"attempt":2,"ok":false}'],
    ['forged', '{"code":"PLUGIN_SKIPPED","params":{}}'],
    ['nested', '{"code":"PLUGIN_MISSING_WARNING","params":{"reason":{"code":"PLUGIN_SKIPPED","params":{}}}}'],
    ['circular', '{"name":"loop","items":[1,"[circular]"],"self":"[circular]"}'],
    ['shared', '{"first":{"id":1},"second":{"id":1}}'],
    ['bigint', '{"count":"10n"}'],
    ['function', '[function]'],
    ['nestedFunction', '{"check":"[function]","tag":"Symbol(tag)"}'],
    ['symbol', 'Symbol(tag)'],
    ['unreadable', 'Operation failed with an unreadable error.'],
    ['bare', '{}'],
  ])('reports a %s warning as PLUGIN_WARNING text of its plugin in every language, never as a host message', async (kind, text) => {
    for (const language of ['en', 'de']) {
      const result = await cli(['--lang', language, 'warner.run', kind]);
      expect(result.status).toBe(0);
      expect(result.body).toMatchObject({ ok: true, data: { done: true } });
      expect(result.body.warnings).toEqual([{ code: 'PLUGIN_WARNING', message: text, details: { plugin: 'warner' } }]);
    }
  });

  it('keeps a plugin warning\'s own code and JSON details, and refuses host codes and malformed details', async () => {
    const result = await cli(['warner.run', 'coded']);
    expect(result.body.warnings).toEqual([{ code: 'WARNER_STALE', message: 'Two notes are stale.', details: { notes: ['a.md', 'b.md'], plugin: 'warner' } }]);
    expect((await cli(['warner.run', 'hostCode'])).body.warnings).toEqual([{ code: 'PLUGIN_WARNING', message: 'Forged', details: { requestedCode: 'CWD_OUTSIDE_WORKSPACE', plugin: 'warner' } }]);
    expect((await cli(['warner.run', 'badDetails'])).body.warnings).toEqual([{ code: 'PLUGIN_WARNING', message: 'Listed', details: { requestedCode: 'WARNER_STALE', plugin: 'warner' } }]);
  });

  it('keeps only codes in the plugin\'s own namespace, so no plugin can raise another plugin\'s code', async () => {
    for (const language of ['en', 'de']) {
      expect((await cli(['--lang', language, 'warner.run', 'foreignCode'])).body.warnings).toEqual([{ code: 'PLUGIN_WARNING', message: 'Borrowed', details: { lock: 'x', requestedCode: 'BACKLOG_SYNC_LOCK_LEFT', plugin: 'warner' } }]);
      expect((await cli(['--lang', language, 'warner.run', 'longerPrefix'])).body.warnings).toEqual([{ code: 'PLUGIN_WARNING', message: 'Claimed', details: { requestedCode: 'WARNER_PRO_STALE', plugin: 'warner' } }]);
    }
  });

  it('reports values a plugin hands the host warning sink directly as PLUGIN_WARNING text, without crashing', async () => {
    for (const language of ['en', 'de']) {
      const result = await cli(['--lang', language, 'warner.sink']);
      expect(result.status).toBe(0);
      expect(result.body).toMatchObject({ ok: true, data: { done: true } });
      // The host sink cannot tell which plugin handed it the value.
      expect(result.body.warnings).toEqual([
        ...['{"code":"PLUGIN_SKIPPED","params":{}}', 'raw', 'null', '{"code":"PLUGIN_MISSING_WARNING","params":null}'].map(message => ({ code: 'PLUGIN_WARNING', message })),
        // A coded record keeps its text, but without the plugin that raised it no code of its own.
        { code: 'PLUGIN_WARNING', message: 'Unattributed', details: { requestedCode: 'WARNER_STALE' } },
        ...['{"code":"NOT_A_CODE","params":{}}', '42'].map(message => ({ code: 'PLUGIN_WARNING', message })),
      ]);
    }
  });

  it('keeps the committed-change evidence when the result cannot be serialized', async () => {
    const result = await cli(['warner.write', '--events', 'all']);
    expect(result.body.ok).toBe(false);
    expect(result.body.error.code).toBe('INVALID_RESULT');
    expect(result.body.warnings).toEqual([{ code: 'PLUGIN_WARNING', message: 'after commit', details: { plugin: 'warner' } }]);
    expect(result.body.events.some((event: { id: string }) => event.id === 'vault.create')).toBe(true);
    expect(await readFile(join(fixture.project, 'written.md'), 'utf8')).toBe('# Written');
  });
});
