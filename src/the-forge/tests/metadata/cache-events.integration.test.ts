import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetadataCacheEvents } from '../../src/application/metadata/cache-events.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { ScopedFiles, scopedCommitObserver } from '../../src/application/workspace/scoped-files.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { metadataIndex } from '../support/metadata.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-metadata-events-'));
  for (const [path, text] of Object.entries({ 'project/Plan.md': '# Plan\n', 'project/Spec.md': 'Draft\n', 'bin/data/context.json': '{}' })) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

/** The composition root's binding: a project-scoped index fed by project commits and mapped environment commits. */
async function invocation(dryRun = false) {
  const events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  const files = await NodeFiles.at(root), scoped = new ScopedFiles(files, 'project');
  const index = metadataIndex(scoped), observer = new MetadataCacheEvents(events, index);
  const environment = new Workspace(files, new ObsidianDocuments(), events, dryRun, root, scopedCommitObserver(observer, 'project'));
  const workspace = environment.within(scoped, join(root, 'project'), observer);
  return { events, index, environment, workspace, revision: async (path: string) => (await scoped.read(path)).revision };
}
const observed = (events: EventBus) => events.history
  .filter(record => /^(vault|metadataCache)\./.test(record.id))
  .map(record => [record.id, (record.payload as { path?: string }).path]);

describe('metadataCache events from committed workspace batches', () => {
  it('follow the batch vault records once a prior read loaded the cache', async () => {
    const { events, index, workspace, revision } = await invocation();
    expect((await index.load()).resolvedLinks['Spec.md']).toEqual({});
    await workspace.write([{ path: 'Spec.md', bytes: encodeText('See [[Plan]] and [[Later]].\n'), expectedRevision: await revision('Spec.md') }]);
    expect(observed(events)).toEqual([
      ['vault.modify', 'Spec.md'], ['metadataCache.changed', 'Spec.md'], ['metadataCache.resolve', 'Spec.md'], ['metadataCache.resolved', undefined],
    ]);
    const changed = events.history.find(record => record.id === 'metadataCache.changed')!.payload as { cache: { links: Array<{ link: string }> } };
    expect(changed.cache.links.map(link => link.link)).toEqual(['Plan', 'Later']);
    expect((await index.load()).resolvedLinks['Spec.md']).toEqual({ 'Plan.md': 1 });

    await workspace.remove('Plan.md', await revision('Plan.md'));
    expect(observed(events).slice(4)).toEqual([
      ['vault.delete', 'Plan.md'], ['metadataCache.deleted', 'Plan.md'], ['metadataCache.resolve', 'Spec.md'], ['metadataCache.resolved', undefined],
    ]);
    expect(events.history.find(record => record.id === 'metadataCache.deleted')!.payload).toEqual({ path: 'Plan.md', prevCache: expect.objectContaining({ headings: [expect.objectContaining({ heading: 'Plan' })] }) });
  });

  it('publishes none for commits before the first load or for dry runs', async () => {
    const unloaded = await invocation();
    await unloaded.workspace.write([{ path: 'New.md', bytes: encodeText('[[Plan]]') }]);
    expect(observed(unloaded.events)).toEqual([['vault.create', 'New.md']]);
    const preview = await invocation(true);
    await preview.index.load();
    await preview.workspace.write([{ path: 'Other.md', bytes: encodeText('[[Plan]]') }]);
    expect(observed(preview.events)).toEqual([]);
    expect(preview.events.history.map(record => record.id)).toContain('workspace.quick-preview');
  });

  it('maps workspace-scope commits into the selected project and skips paths outside it', async () => {
    const { events, index, environment } = await invocation();
    await index.load();
    await environment.write([{ path: 'bin/data/context.json', bytes: encodeText('{"project":"project"}'), expectedRevision: (await environment.files.read('bin/data/context.json')).revision }]);
    expect(observed(events)).toEqual([['vault.modify', 'bin/data/context.json']]);
    await environment.write([{ path: 'project/Later.md', bytes: encodeText('# Later\n') }, { path: 'outside/Note.md', bytes: encodeText('[[Plan]]') }]);
    expect(observed(events).slice(1)).toEqual([
      ['vault.create', 'outside'], ['vault.create', 'project/Later.md'], ['vault.create', 'outside/Note.md'],
      ['metadataCache.changed', 'Later.md'], ['metadataCache.resolve', 'Later.md'], ['metadataCache.resolved', undefined],
    ]);
    expect((await index.load()).files()).toEqual(['Later.md', 'Plan.md', 'Spec.md']);
  });

  it('turns a failed post-commit update into a warning without undoing the commit', async () => {
    const events = new EventBus(new NodeEventScope());
    registerHostEvents(events);
    const workspace = new Workspace(await NodeFiles.at(root), new ObsidianDocuments(), events, false, root, { committed: async () => { throw new Error('index unavailable'); } });
    const result = await workspace.write([{ path: 'project/New.md', bytes: encodeText('# New') }]);
    expect(result.changes.map(change => change.path)).toEqual(['project/New.md']);
    expect(events.warnings).toEqual(['Committed 1 file(s); post-commit update failed: index unavailable']);
    expect(events.history.map(record => record.id)).toContain('operation.succeeded');
  });
});
