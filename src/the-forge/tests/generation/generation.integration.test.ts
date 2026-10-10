import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GenerationService } from '../../src/application/generation/plans.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';

let root: string, files: NodeFiles, workspace: Workspace;
const write = (path: string, content: string) => ({ path, bytes: encodeText(content) });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-generation-')); files = await NodeFiles.at(root);
  workspace = new Workspace(files, new ObsidianDocuments(), new EventBus(new NodeEventScope()), false);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe('generation review and explicit revision authorization', () => {
  it('plans existing and missing artifacts without writes and reports text for review', async () => {
    await files.writeBatch([write('ui/same.ts', 'same'), write('ui/changed.ts', 'before')], false);
    const service = new GenerationService(workspace), spy = vi.spyOn(files, 'writeBatch');
    const writes = [write('ui/same.ts', 'same'), write('ui/changed.ts', 'after'), write('ui/new.ts', 'new')];
    const plan = await service.plan(writes);
    expect(spy).not.toHaveBeenCalled(); expect(workspace.events.history).toEqual([]);
    expect(plan.matches).toBe(false);
    expect(plan.outputs).toEqual([
      { path: 'ui/same.ts', status: 'unchanged', revision: expect.any(String), content: 'same' },
      { path: 'ui/changed.ts', status: 'changed', revision: expect.any(String), content: 'after', currentContent: 'before' },
      { path: 'ui/new.ts', status: 'missing', content: 'new' },
    ]);
    expect(Object.keys(plan.revisions)).toEqual(['ui/changed.ts', 'ui/same.ts']);
    expect(await service.plan(writes)).toEqual(plan);
  });

  it('persists only a guarded revision manifest then rejects intervening output edits', async () => {
    await files.writeBatch([write('ui/item.ts', 'before')], false);
    const service = new GenerationService(workspace), writes = [write('ui/item.ts', 'after')];
    const plan = await service.plan(writes, 'reviews/first.json');
    expect(JSON.parse(new TextDecoder().decode((await files.read('reviews/first.json')).bytes))).toEqual(plan.revisions);
    expect(new TextDecoder().decode((await files.read('ui/item.ts')).bytes)).toBe('before');
    await expect(service.plan(writes, 'reviews/first.json')).rejects.toMatchObject({ code: 'CONFLICT' });
    const before = await files.read('ui/item.ts');
    await files.writeBatch([{ ...write('ui/item.ts', 'manual edit'), expectedRevision: before.revision }], false);
    await expect(service.commit(writes, plan.revisions)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('--plan-out') });
    expect(new TextDecoder().decode((await files.read('ui/item.ts')).bytes)).toBe('manual edit');
  });

  it('previews manifest creation without files and guards manifest/output collisions', async () => {
    const dry = new GenerationService(new Workspace(files, workspace.codec, workspace.events, true));
    const writes = [write('ui/item.ts', 'content')];
    const plan = await dry.plan(writes, 'reviews/new.json');
    expect(plan.manifest).toMatchObject({ path: 'reviews/new.json', dryRun: true });
    expect(await files.list()).toEqual([]); expect(workspace.events.history).toEqual([]);
    await expect(dry.plan(writes, 'ui/item.ts')).rejects.toMatchObject({ code: 'INVALID_GENERATION_PLAN' });
    await expect(dry.plan([...writes, ...writes])).rejects.toMatchObject({ code: 'INVALID_GENERATION_PLAN' });
    const live = new GenerationService(workspace);
    for (const manifest of ['ui', 'ui/item.ts/review.json']) await expect(live.plan(writes, manifest)).rejects.toMatchObject({ code: 'INVALID_GENERATION_PLAN' });
    for (const overlap of [[write('ui', 'file'), ...writes], [...writes, write('ui', 'file')]]) await expect(live.plan(overlap)).rejects.toMatchObject({ code: 'INVALID_GENERATION_PLAN' });
    expect(await files.list()).toEqual([]); expect(workspace.events.history).toEqual([]);
  });

  it('provides CI drift status with no writes and succeeds after explicit generation', async () => {
    const service = new GenerationService(workspace), writes = [write('ui/item.ts', 'content')];
    await expect(service.check(writes, 'UI_DRIFT')).rejects.toMatchObject({ code: 'UI_DRIFT', exitCode: 5, details: { outputs: [{ path: 'ui/item.ts', status: 'missing' }] } });
    expect(await files.list()).toEqual([]);
    await service.commit(writes);
    expect((await service.check(writes, 'UI_DRIFT')).matches).toBe(true);
    await expect(service.check([write('ui/item.ts', 'changed')], 'DATA_SOURCE_DRIFT')).rejects.toMatchObject({ code: 'DATA_SOURCE_DRIFT', exitCode: 5, details: { outputs: [{ path: 'ui/item.ts', status: 'changed' }] } });
    expect(new TextDecoder().decode((await files.read('ui/item.ts')).bytes)).toBe('content');
  });

  it('treats every revision key as path data, including object property names', async () => {
    const service = new GenerationService(workspace);
    await service.commit([write('__proto__', 'before'), write('toString', 'before')], {});
    const writes = [write('__proto__', 'after'), write('toString', 'after')];
    const plan = await service.plan(writes, 'review.json');
    expect(Object.keys(plan.revisions)).toEqual(['__proto__', 'toString']);
    expect(JSON.parse(new TextDecoder().decode((await files.read('review.json')).bytes))).toEqual(plan.revisions);
    await service.commit(writes, plan.revisions);
    expect((await service.check(writes, 'UI_DRIFT')).matches).toBe(true);
  });
});
