import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parsePlan } from '../../src/domain/documents/apply-plan.ts';
import { PlanRunner } from '../../src/application/documents/apply.ts';
import { vaultScope, writeVault } from '../support/vault.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-apply-')); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

const text = (path: string) => readFile(join(root, path), 'utf8');
async function tree(directory = root, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await tree(join(directory, entry.name), `${prefix}${entry.name}/`));
    else result.push(prefix + entry.name);
  }
  return result.sort();
}
const vault = {
  'Index.md': '# Index\n\nSee [[Plan]] and [[Old]].\n',
  'notes/Plan.md': '---\nstatus: draft\n---\n# Plan\n\n## Risks\n\n- Scope\n\n## Goals\n\nShip.\n',
  'notes/Old.md': '# Old\n',
  'notes/Scratch.md': 'scratch\n',
};
async function runner(options: { dryRun?: boolean } = {}) {
  const scope = await vaultScope(root, options);
  const run = (operations: unknown[]) => new PlanRunner({ workspace: scope.workspace, metadata: scope.metadata, workspaceScope: true }).run(parsePlan({ version: 1, operations }));
  const operations = () => scope.events.history.filter(record => record.id.startsWith('operation.')).map(record => [record.id, (record.payload as { operation: string }).operation]);
  return { ...scope, run, operations };
}

describe('apply plans', () => {
  it('commits a mixed plan atomically in one batch with one set of events', async () => {
    await writeVault(root, vault);
    const { run, files, records, operations } = await runner();
    const plan = await files.read('notes/Plan.md');
    const result = await run([
      { op: 'write', path: 'notes/New.md', content: '# New\n\nLinks to [[Plan]].\n' },
      { op: 'edit', path: 'notes/Plan.md', section: 'Plan > Risks', append: '- Staffing', ifMatch: plan.revision },
      { op: 'frontmatter', path: 'notes/Plan.md', set: { status: 'active' }, ifMatch: plan.revision },
      { op: 'move', from: 'notes/Plan.md', to: 'specs/Roadmap.md', ifMatch: plan.revision },
      { op: 'edit', path: 'specs/Roadmap.md', edits: [{ find: 'Ship.', replace: 'Ship v1.' }], ifMatch: plan.revision },
      { op: 'delete', path: 'notes/Scratch.md' },
    ]);
    expect(result.operations.map(item => [item.index, item.op, item.path])).toEqual([
      [0, 'write', 'notes/New.md'], [1, 'edit', 'notes/Plan.md'], [2, 'frontmatter', 'notes/Plan.md'], [3, 'move', 'notes/Plan.md'], [4, 'edit', 'specs/Roadmap.md'], [5, 'delete', 'notes/Scratch.md'],
    ]);
    expect(result.operations[3]).toMatchObject({ to: 'specs/Roadmap.md', links: { updated: 2, files: 2 } });
    expect(result.operations[5]).toMatchObject({ trashPath: '.trash/notes/Scratch.md' });
    expect(await text('specs/Roadmap.md')).toBe('---\nstatus: active\n---\n# Plan\n\n## Risks\n\n- Scope\n- Staffing\n\n## Goals\n\nShip v1.\n');
    expect(await text('notes/New.md')).toBe('# New\n\nLinks to [[Roadmap]].\n');
    expect(await text('Index.md')).toBe('# Index\n\nSee [[Roadmap]] and [[Old]].\n');
    expect(await tree()).toEqual(['.trash/notes/Scratch.md', 'Index.md', 'notes/New.md', 'notes/Old.md', 'specs/Roadmap.md']);
    expect(operations()).toEqual([['operation.started', 'apply'], ['operation.succeeded', 'apply']]);
    expect(records()).toEqual([
      ['vault.create', 'specs'], ['vault.rename', 'specs/Roadmap.md'],
      ['vault.delete', 'notes/Scratch.md'],
      ['vault.modify', 'Index.md'], ['vault.create', 'notes/New.md'], ['vault.modify', 'specs/Roadmap.md'],
      ['metadataCache.changed', 'Index.md'], ['metadataCache.changed', 'notes/New.md'], ['metadataCache.changed', 'specs/Roadmap.md'],
      ['metadataCache.deleted', 'notes/Scratch.md'],
      ['metadataCache.resolve', 'Index.md'], ['metadataCache.resolve', 'notes/New.md'], ['metadataCache.resolve', 'specs/Roadmap.md'],
      ['metadataCache.resolved', undefined],
    ]);
  });

  it('previews the whole plan as diffs against the original files and writes nothing', async () => {
    await writeVault(root, vault);
    const { run, records } = await runner({ dryRun: true });
    const result = await run([
      { op: 'edit', path: 'notes/Plan.md', block: 'missing', append: 'x' },
    ]).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: 'SECTION_NOT_FOUND', details: { operation: 0, block: 'missing' } });
    const preview = await run([
      { op: 'move', from: 'notes/Plan.md', to: 'specs/Plan.md' },
      { op: 'edit', path: 'specs/Plan.md', edits: [{ find: 'Ship.', replace: 'Ship v1.' }] },
    ]);
    expect(preview.dryRun).toBe(true);
    expect(preview.renames).toEqual([{ from: 'notes/Plan.md', to: 'specs/Plan.md', kind: 'file', revision: expect.any(String), bytes: vault['notes/Plan.md'].length }]);
    expect(preview.changes).toEqual([expect.objectContaining({ path: 'specs/Plan.md', operation: 'updated', diff: expect.stringContaining('-Ship.\n+Ship v1.\n') })]);
    expect(await tree()).toEqual(Object.keys(vault).sort());
    expect(records()).toEqual([]);
  });

  it('fails on the operation whose revision is stale or whose edit fails, before anything is written', async () => {
    await writeVault(root, vault);
    const { run, files, records } = await runner();
    const old = await files.read('notes/Old.md');
    await expect(run([
      { op: 'edit', path: 'notes/Old.md', append: 'more\n', ifMatch: old.revision },
      { op: 'move', from: 'notes/Old.md', to: 'notes/Older.md', ifMatch: old.revision },
      { op: 'edit', path: 'Index.md', append: 'x', ifMatch: 'stale' },
    ])).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/^Operation 2 \(edit\): /), details: { operation: 2, path: 'Index.md', expectedRevision: 'stale' } });
    await expect(run([
      { op: 'write', path: 'notes/Other.md', content: 'x' },
      { op: 'edit', path: 'notes/Old.md', edits: [{ find: 'Old', replace: 'Older' }, { find: 'Nope', replace: '' }] },
    ])).rejects.toMatchObject({ code: 'NO_MATCH', details: { operation: 1, edit: 1 } });
    await expect(run([{ op: 'write', path: 'Index.md', content: 'blind' }])).rejects.toMatchObject({ code: 'CONFLICT', details: { operation: 0, currentRevision: expect.any(String) } });
    await expect(run([{ op: 'delete', path: 'notes/Old.md' }])).rejects.toMatchObject({ code: 'HAS_BACKLINKS', details: { operation: 0 } });
    expect(await tree()).toEqual(Object.keys(vault).sort());
    expect(await text('notes/Old.md')).toBe(vault['notes/Old.md']);
    expect(records()).toEqual([]);
  });

  it('refuses a file that changed between planning and commit, and rolls back when committing fails', async () => {
    await writeVault(root, vault);
    const scope = await runner();
    const replace = (scope.files as unknown as { replace: (target: string, ...args: unknown[]) => Promise<void> }).replace.bind(scope.files);
    vi.spyOn(scope.files as unknown as { replace: typeof replace }, 'replace').mockImplementation(async (target, ...args) => {
      if (basename(target) === 'Extra.md') throw new Error('Injected write failure');
      await replace(target, ...args);
    });
    await expect(scope.run([
      { op: 'move', from: 'notes/Plan.md', to: 'specs/Plan.md' },
      { op: 'write', path: 'specs/Extra.md', content: 'extra' },
    ])).rejects.toThrow('Injected write failure');
    expect(await tree()).toEqual(Object.keys(vault).sort());
    vi.restoreAllMocks();
    const changing = await runner();
    const read = changing.files.read.bind(changing.files);
    let changed = false;
    vi.spyOn(changing.files, 'read').mockImplementation(async path => {
      const snapshot = await read(path);
      if (path === 'Index.md' && !changed) { changed = true; await writeFile(join(root, 'Index.md'), 'changed elsewhere\n'); }
      return snapshot;
    });
    await expect(changing.run([{ op: 'edit', path: 'Index.md', append: 'x\n' }])).rejects.toMatchObject({ code: 'CONFLICT', details: { operation: 0, path: 'Index.md' } });
    expect(await text('Index.md')).toBe('changed elsewhere\n');
    expect(changing.records()).toEqual([]);
  });

  it('names the operation whose moved, trashed or folder-moved source changed between planning and commit', async () => {
    const cases: [unknown[], string, number, string][] = [
      [[{ op: 'write', path: 'specs/README.md', content: 'specs' }, { op: 'move', from: 'notes/Plan.md', to: 'specs/Plan.md' }], 'notes/Plan.md', 1, 'notes/Plan.md'],
      [[{ op: 'edit', path: 'Index.md', append: 'x\n' }, { op: 'delete', path: 'notes/Scratch.md', allowBrokenLinks: true }], 'notes/Scratch.md', 1, 'notes/Scratch.md'],
      [[{ op: 'write', path: 'specs/README.md', content: 'specs' }, { op: 'move', from: 'notes', to: 'archive/notes' }], 'notes/Old.md', 1, 'notes'],
    ];
    for (const [operations, changed, operation, path] of cases) {
      await rm(root, { recursive: true, force: true });
      await writeVault(root, vault);
      const scope = await runner();
      // The test hook: another writer changes the source after the plan was built, just before it commits.
      const commit = scope.workspace.commit.bind(scope.workspace);
      vi.spyOn(scope.workspace, 'commit').mockImplementation(async (...args) => {
        await writeFile(join(root, changed), 'changed elsewhere\n');
        return commit(...args);
      });
      const failure = await scope.run(operations).then(() => undefined, (error: unknown) => error as { code: string; message: string; details: Record<string, unknown> });
      expect(failure, path).toMatchObject({ code: 'CONFLICT', details: { operation, path } });
      expect(failure!.message).toMatch(new RegExp(`^Operation ${operation} \\(\\w+\\): .*ifMatch`));
      expect(failure!.message).not.toContain('--if-match');
      expect(await text(changed)).toBe('changed elsewhere\n');
      vi.restoreAllMocks();
    }
  });

  it('commits a moved folder as one folder rename and refuses to reuse a vacated path', async () => {
    await writeVault(root, vault);
    const { run, records } = await runner();
    const result = await run([
      { op: 'move', from: 'notes', to: 'archive/notes' },
      { op: 'edit', path: 'archive/notes/Old.md', append: 'archived\n' },
      { op: 'write', path: 'archive/notes/README.md', content: 'Archived notes.\n' },
    ]);
    expect(result.renames.slice(0, 1)).toEqual([{ from: 'notes', to: 'archive/notes', kind: 'folder' }]);
    expect(records().filter(([id]) => id.startsWith('vault.'))).toEqual([
      ['vault.create', 'archive'], ['vault.rename', 'archive/notes'], ['vault.rename', 'archive/notes/Old.md'], ['vault.rename', 'archive/notes/Plan.md'], ['vault.rename', 'archive/notes/Scratch.md'],
      ['vault.modify', 'archive/notes/Old.md'], ['vault.create', 'archive/notes/README.md'],
    ]);
    expect(await tree()).toEqual(['Index.md', 'archive/notes/Old.md', 'archive/notes/Plan.md', 'archive/notes/README.md', 'archive/notes/Scratch.md']);
    expect(await text('Index.md')).toBe(vault['Index.md']);
    await expect(run([
      { op: 'move', from: 'Index.md', to: 'Home.md' },
      { op: 'write', path: 'Index.md', content: 'new index' },
    ])).rejects.toMatchObject({ code: 'INVALID_PLAN', details: { operation: 1, path: 'Index.md', vacated: 'Index.md' } });
  });

  it('writes nothing for a file the plan creates and deletes, or for unchanged frontmatter', async () => {
    await writeVault(root, vault);
    const { run, records } = await runner();
    const result = await run([
      { op: 'write', path: 'tmp/Draft.md', content: 'draft' },
      { op: 'move', from: 'tmp/Draft.md', to: 'tmp/Later.md' },
      { op: 'delete', path: 'tmp/Later.md' },
      { op: 'frontmatter', path: 'notes/Plan.md', set: { status: 'draft' } },
    ]);
    expect(result).toMatchObject({ dryRun: false, renames: [], changes: [] });
    expect(result.operations[3]).toMatchObject({ op: 'frontmatter', changed: false });
    expect(await tree()).toEqual(Object.keys(vault).sort());
    expect(records()).toEqual([]);
  });
});
