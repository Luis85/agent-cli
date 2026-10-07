import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventRecord } from '../../src/the-forge/application/plugins/events.ts';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();

async function plugin(name: string, failure = false) {
  const root = join(fixture.project, name), directory = join(root, 'bin/plugins/observer');
  await mkdir(directory, { recursive: true });
  await writeFile(join(root, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['observer'] } }));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ id: 'observer', name: 'Observer', version: '1.0.0', minAppVersion: '0.1.0', description: 'Observe host processes', author: 'Tests' }));
  await writeFile(join(directory, 'main.mjs'), `
    const replayed = [], live = [];
    export default {
      async onload(context) {
        await context.events.replay(record => { replayed.push(record.id); });
        context.events.onAny(record => { live.push(record.id); });
        context.events.on('command.failed', payload => { context.events.warn('failure observed: ' + payload.error.code); });
        context.events.on('plugin.unloading', () => { context.events.warn('cleanup observed'); });
      },
      onunload() { throw Object.create(null); },
      commands: [{ id: 'observer.run', description: 'Write and observe', usage: 'observer.run', async run(args, flags, context) {
        await context.workspace.write([{ path: 'result.md', bytes: new TextEncoder().encode('private body'), mode: 'create' }]);
        return ${failure ? '{ invalid: 1n }' : '{ replayed, live }'};
      } }]
    };
  `);
  return { root, run: () => fixture.cli(['observer.run', 'private-argument'], undefined, { root }) };
}

describe('portable host lifecycle observation', () => {
  it('replays pre-activation phases and observes file operations through the public SDK', async () => {
    const configured = await plugin('observe-success'), result = configured.run();
    expect(result.status, result.stdout).toBe(0);
    expect(result.body.data.replayed).toEqual(['plugin.registered', 'command.started', 'plugin.activating']);
    expect(result.body.data.live).toEqual(['plugin.activated', 'workspace.started', 'file.created', 'workspace.succeeded']);
    expect(result.body.events.map((event: EventRecord) => event.id)).toEqual([
      'plugin.registered', 'command.started', 'plugin.activating', 'plugin.activated',
      'workspace.started', 'file.created', 'workspace.succeeded', 'command.succeeded',
      'plugin.unloading', 'plugin.unload-failed',
    ]);
    expect(result.body.events.find((event: EventRecord) => event.id === 'workspace.started')?.payload).toMatchObject({ root: configured.root, paths: ['result.md'], dryRun: false });
    expect(JSON.stringify(result.body.events)).not.toMatch(/private body|private-argument/);
    expect(result.body.warnings).toContain('cleanup observed');
    expect(result.body.warnings).toContain('Plugin cleanup: Operation failed with an unreadable error.');
  });

  it('reports invalid results before unloading and retains the committed file evidence', async () => {
    const result = (await plugin('observe-invalid-result', true)).run();
    expect(result.status).toBe(1);
    expect(result.body.error.code).toBe('INVALID_RESULT');
    expect(result.body.events).toContainEqual(expect.objectContaining({ id: 'file.created' }));
    expect(result.body.events).toContainEqual(expect.objectContaining({ id: 'command.failed', payload: expect.objectContaining({ error: { code: 'INVALID_RESULT', exitCode: 1 } }) }));
    expect(result.body.events.some((event: EventRecord) => event.id === 'command.succeeded')).toBe(false);
    expect(result.body.warnings).toContain('failure observed: INVALID_RESULT');
    expect(result.body.warnings).toContain('cleanup observed');
  });
});
