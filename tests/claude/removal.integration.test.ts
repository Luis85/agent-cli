import { NodeEventScope } from '../../src/the-forge/infrastructure/plugins/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/the-forge/application/plugins/events.ts';
import { ScopedFiles } from '../../src/the-forge/application/workspace/scoped-files.ts';
import { Workspace } from '../../src/the-forge/application/workspace/workspace.ts';
import { ObsidianDocuments } from '../../src/the-forge/infrastructure/documents/codec.ts';
import { NodeFiles } from '../../src/the-forge/infrastructure/workspace/files.ts';

let root: string, files: NodeFiles, events: EventBus;
const asset = '.claude/agents/reviewer.md';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-removal-'));
  files = await NodeFiles.at(root);
  events = new EventBus(new NodeEventScope());
  events.define({ id: 'file.deleted', validate: (value): value is object => typeof value === 'object' });
  await mkdir(join(root, '.claude/agents'), { recursive: true });
  // Removing a damaged definition must not require parsing that definition first.
  await writeFile(join(root, asset), '---\ninvalid: [\n');
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const workspace = (dryRun = false) => new Workspace(files, new ObsidianDocuments(), events, dryRun);

describe('guarded native asset removal', () => {
  it('removes exactly the inspected file and publishes its previous revision after commit', async () => {
    const before = await files.read(asset);
    await writeFile(join(root, '.claude/agents/other.md'), 'Keep');
    const observe = vi.fn(async () => { await expect(readFile(join(root, asset))).rejects.toMatchObject({ code: 'ENOENT' }); });
    events.on('file.deleted', observe);
    const result = await workspace().remove(asset, before.revision);
    expect(result).toEqual({ dryRun: false, changes: [{ path: asset, operation: 'deleted', revision: before.revision, bytes: before.bytes.length }] });
    expect(await readdir(join(root, '.claude/agents'))).toEqual(['other.md']);
    expect(observe).toHaveBeenCalledOnce();
    expect(events.history).toEqual([{ id: 'file.deleted', payload: result.changes[0] }]);
    expect(await readdir(root)).toEqual(['.claude']);
  });

  it('previews the same removal while retaining bytes, directories and an empty event history', async () => {
    const before = await files.read(asset);
    const preview = await workspace(true).remove(asset, before.revision);
    expect(preview).toEqual({ dryRun: true, changes: [{ path: asset, operation: 'deleted', revision: before.revision, bytes: before.bytes.length }] });
    expect(await files.read(asset)).toEqual(before);
    expect(await readdir(root)).toEqual(['.claude']);
    expect(events.history).toEqual([]);
    expect((await workspace().remove(asset, before.revision)).changes).toEqual(preview.changes);
    expect(await readdir(join(root, '.claude'))).toEqual(['agents']);
  });

  it.each([false, true])('rejects stale, absent or malformed revisions without removing anything (dry run: %s)', async dryRun => {
    for (const revision of ['stale', '', undefined, null, 1]) {
      await expect(workspace(dryRun).remove(asset, revision as string)).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    expect((await files.read(asset)).bytes.length).toBeGreaterThan(0);
    expect(events.history).toEqual([]);
    expect(await readdir(root)).toEqual(['.claude']);
  });

  it('rejects missing files, directories, reserved paths and traversal', async () => {
    const before = await files.read(asset);
    await expect(workspace().remove('missing.md', before.revision)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const path of ['.claude/agents', '../outside.md', '.git/config', '.agent-cli.lock']) {
      await expect(workspace().remove(path, before.revision)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    }
    expect(await files.read(asset)).toEqual(before);
    expect(events.history).toEqual([]);
  });

  it('rejects symlinked files and directory components', async () => {
    const before = await files.read(asset);
    await symlink(join(root, asset), join(root, 'alias.md'));
    await symlink(join(root, '.claude'), join(root, 'alias-directory'));
    for (const path of ['alias.md', 'alias-directory/agents/reviewer.md']) {
      await expect(workspace().remove(path, before.revision)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    }
    expect(await files.read(asset)).toEqual(before);
  });

  it('shares the writer lock and preserves another writer’s existing lock', async () => {
    const before = await files.read(asset);
    await writeFile(join(root, '.agent-cli.lock'), 'Other writer');
    await expect(workspace().remove(asset, before.revision)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
    expect(await readFile(join(root, '.agent-cli.lock'), 'utf8')).toBe('Other writer');
    expect(await files.read(asset)).toEqual(before);
  });

  it('rechecks a concurrent external edit immediately before removal', async () => {
    const before = await files.read(asset);
    const adapter = files as unknown as { assertRevision(path: string, revision: string): Promise<void> };
    const verify = adapter.assertRevision.bind(files);
    vi.spyOn(adapter, 'assertRevision').mockImplementationOnce(async (...args) => {
      await writeFile(join(root, asset), 'External edit');
      await verify(...args);
    });
    await expect(workspace().remove(asset, before.revision)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(join(root, asset), 'utf8')).toBe('External edit');
    expect(events.history).toEqual([]);
    expect(await readdir(root)).toEqual(['.claude']);
  });

  it('returns committed evidence when notifications or lock cleanup fail', async () => {
    const warnings: string[] = [];
    files = await NodeFiles.at(root, message => warnings.push(message));
    const before = await files.read(asset);
    events.on('file.deleted', () => { throw new Error('Observer failed'); });
    const adapter = files as unknown as { releaseLock(path: string): Promise<void> };
    vi.spyOn(adapter, 'releaseLock').mockRejectedValueOnce(new Error('Lock cleanup failed'));
    expect((await workspace().remove(asset, before.revision)).changes[0]?.operation).toBe('deleted');
    await expect(readFile(join(root, asset))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events.warnings).toEqual([expect.stringContaining('Observer failed')]);
    expect(warnings).toEqual([expect.stringContaining('Lock cleanup failed')]);
  });

  it('isolates selected-project removals and reports project-relative paths', async () => {
    await mkdir(join(root, 'projects/alpha/.claude/agents'), { recursive: true });
    await writeFile(join(root, 'projects/alpha', asset), 'Project agent');
    const scoped = new ScopedFiles(files, 'projects/alpha');
    const before = await scoped.read(asset);
    const result = await new Workspace(scoped, new ObsidianDocuments(), events, false).remove(asset, before.revision);
    expect(result.changes[0]).toMatchObject({ path: asset, operation: 'deleted' });
    expect((await files.read(asset)).bytes.length).toBeGreaterThan(0);
    expect(await scoped.list()).toEqual([]);
    await expect(scoped.remove('../escape', before.revision, false)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
});
