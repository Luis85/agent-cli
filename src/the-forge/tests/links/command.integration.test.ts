import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { Registry, type CommandContext } from '../../src/application/plugins/registry.ts';
import { registerCorePlugins, registrySkills } from '../../src/application/plugins/core-plugins.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { linksPlugin } from '../../src/plugins/links/plugin.ts';
import { scopeServices } from '../support/metadata.ts';
import { offlineHost } from '../support/core-plugins.ts';

let root: string;
const put = async (path: string, content: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
};
/** Registers the links core plugin like the composition root, with `settings` as plugins.settings. */
async function links(settings: Record<string, unknown> = {}) {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  registerCorePlugins(registry, events, [linksPlugin], { skills: registrySkills(registry), fileDates: () => { throw new Error('links reads no file dates'); }, ...offlineHost }, []);
  registry.settings.configure(settings, new Set(registry.origins.keys()));
  const workspace = new Workspace(await NodeFiles.at(root), new ObsidianDocuments(), events, false);
  const context = { workspace, events, root, workspaceRoot: root, project: null, input: async () => new Uint8Array(), ...scopeServices(workspace, events) } as unknown as CommandContext;
  return (args: string[], flags: Record<string, string> = {}) => registry.commands.get('links')!.run(args, flags, context) as Promise<Record<string, unknown>>;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-links-'));
  await put('index.md', '[[notes/a]]\n');
  await put('notes/a.md', '[[b]] [[c]]\n');
  await put('notes/b.md', 'No links.\n');
  await put('notes/lonely.md', 'Nobody links here.\n');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('the links command', () => {
  it('routes every action and reports from the files on disk', async () => {
    const run = await links();
    expect(await run(['out', 'notes/a.md'])).toMatchObject({ path: 'notes/a.md', links: [{ target: 'notes/b.md' }, { status: 'unresolved', reason: 'missing', link: 'c' }] });
    expect(await run(['back', 'notes/b.md'])).toMatchObject({ backlinks: [{ source: 'notes/a.md', line: 1, column: 1 }] });
    expect(await run(['unresolved'], { path: 'notes/**' })).toMatchObject({ links: [{ source: 'notes/a.md', original: '[[c]]' }], issues: [] });
    expect(await run(['orphans'])).toEqual({ files: ['index.md', 'notes/lonely.md'], issues: [] });
    expect(await run(['deadends'], { path: 'notes/*' })).toEqual({ files: ['notes/b.md', 'notes/lonely.md'], issues: [] });
  });

  it('never reports configured roots as orphans', async () => {
    const run = await links({ links: { roots: ['index.md', 'archive/**'] } });
    expect((await run(['orphans'])).files).toEqual(['notes/lonely.md']);
  });

  it('validates actions, arguments and options', async () => {
    const run = await links();
    for (const [args, flags] of [[[], {}], [['sideways'], {}], [['out'], {}], [['out', 'a.md', 'b.md'], {}], [['back', 'notes/a.md'], { path: '**' }], [['orphans', 'x'], {}], [['unresolved'], { path: '{' }]] as const) {
      await expect(run([...args], { ...flags }), JSON.stringify(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    await expect(run(['out', 'notes/missing.md'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
