import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../../src/the-forge/application/workspace/workspace.ts';
import { EventBus } from '../../src/the-forge/application/plugins/events.ts';
import { registerHostEvents } from '../../src/the-forge/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/the-forge/infrastructure/plugins/event-scope.ts';
import { NodeFiles, revisionOf } from '../../src/the-forge/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/the-forge/infrastructure/documents/codec.ts';
import { applyUnifiedDiff } from '../support/unified-diff.ts';

let root: string, files: NodeFiles;
const note = '---\nstatus: draft\n---\n# Plan\n\nOne\nTwo\nThree\nFour\nFive\nSix\nSeven\n';
const workspace = (dryRun: boolean) => {
  const events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  return { events, workspace: new Workspace(files, new ObsidianDocuments(), events, dryRun, root) };
};
const replaceFour = (bytes: Uint8Array) => encodeText(Buffer.from(bytes).toString('utf8').replace('Four', 'Vier'));
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-dry-run-diffs-'));
  files = await NodeFiles.at(root);
  await writeFile(join(root, 'note.md'), note);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('dry-run unified diffs', () => {
  it('previews an edit with a diff that reproduces the real write', async () => {
    const revision = revisionOf(encodeText(note));
    const preview = await workspace(true).workspace.edit('note.md', revision, replaceFour);
    const [change] = preview.changes as Array<{ diff: string | null; operation: string }>;
    expect(change).toMatchObject({ operation: 'updated', diff: expect.stringContaining('-Four\n+Vier\n') });
    expect(change!.diff!.startsWith('--- a/note.md\n+++ b/note.md\n@@ -6,7 +6,7 @@\n')).toBe(true);
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe(note);
    await workspace(false).workspace.edit('note.md', revision, replaceFour);
    expect(applyUnifiedDiff(note, change!.diff!)).toBe(await readFile(join(root, 'note.md'), 'utf8'));
  });

  it('produces patches that Git applies to the previewed files', async () => {
    const created = 'export const value = 1;\n';
    const result = await workspace(true).workspace.write([
      { path: 'src/value.ts', bytes: encodeText(created) },
      { path: 'note.md', bytes: replaceFour(encodeText(note)), expectedRevision: revisionOf(encodeText(note)) },
    ], { diff: true });
    const patch = (result.changes as Array<{ diff: string }>).map(change => change.diff).join('');
    await writeFile(join(root, 'preview.patch'), patch);
    const applied = spawnSync('git', ['apply', '--unsafe-paths', 'preview.patch'], { cwd: root, encoding: 'utf8' });
    expect(applied.stderr).toBe('');
    expect(applied.status).toBe(0);
    expect(await readFile(join(root, 'src/value.ts'), 'utf8')).toBe(created);
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe(note.replace('Four', 'Vier'));
  });

  it('reports binary previews without a diff and keeps diffs out of lifecycle records', async () => {
    await mkdir(join(root, 'assets'));
    const { workspace: preview, events } = workspace(true);
    const result = await preview.write([{ path: 'assets/logo.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }, { path: 'data.json', bytes: new Uint8Array([0xff]) }], { diff: true });
    expect(result.changes).toEqual([
      expect.objectContaining({ path: 'assets/logo.png', operation: 'created', bytes: 4, diff: null }),
      expect.objectContaining({ path: 'data.json', operation: 'created', bytes: 1, diff: null }),
    ]);
    expect(JSON.stringify(events.history)).not.toContain('"diff"');
    expect(events.history.map(record => record.id)).not.toContain('file.created');
  });

  it('keeps ordinary writes and real commits free of preview diffs', async () => {
    const plain = await workspace(true).workspace.write([{ path: 'plain.md', bytes: encodeText('# Plain\n') }]);
    expect(plain.changes[0]).not.toHaveProperty('diff');
    const real = await workspace(false).workspace.write([{ path: 'real.md', bytes: encodeText('# Real\n') }], { diff: true });
    expect(real.changes[0]).not.toHaveProperty('diff');
  });

  it('applies --if-match on dry runs exactly like the real write', async () => {
    const stale = revisionOf(encodeText('older'));
    for (const dryRun of [true, false]) {
      const target = workspace(dryRun).workspace;
      await expect(target.edit('note.md', stale, replaceFour)).rejects.toMatchObject({ code: 'CONFLICT', exitCode: 2 });
      await expect(target.write([{ path: 'note.md', bytes: encodeText('x'), expectedRevision: stale }], { diff: true })).rejects.toMatchObject({ code: 'CONFLICT', exitCode: 2 });
      await expect(target.write([{ path: 'note.md', bytes: encodeText('x') }], { diff: true })).rejects.toMatchObject({ code: 'CONFLICT', exitCode: 2 });
    }
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe(note);
  });
});
