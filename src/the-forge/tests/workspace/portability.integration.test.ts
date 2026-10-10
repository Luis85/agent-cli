import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { metadataIndex } from '../support/metadata.ts';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { documentCommands } from '../../src/presentation/documents/commands.ts';

let parent: string, root: string, context: CommandContext;
beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), 'forge-portability-'));
  root = join(parent, 'vault');
  await mkdir(root);
  const events = new EventBus(new NodeEventScope());
  for (const id of ['file.created', 'file.updated']) events.define({ id, validate: (value): value is object => typeof value === 'object' });
  const workspace = new Workspace(await NodeFiles.at(root), new ObsidianDocuments(), events, false);
  context = { workspace, events, root, workspaceRoot: root, project: null, claude: { execute: async () => { throw new Error('Unexpected Claude invocation'); } }, metadata: metadataIndex(workspace.files), input: async () => new Uint8Array() };
});
afterEach(async () => { await rm(parent, { recursive: true, force: true }); });

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const command = (id: string) => documentCommands().find(candidate => candidate.id === id)!;
const run = (id: string, args: string[], flags: Record<string, string | boolean> = {}) => Promise.resolve(command(id).run(args, flags, context));
const revision = async (path: string) => (await run('read', [path]) as { revision: string }).revision;

/** macOS (APFS/HFS+) and Windows (NTFS) default to case-insensitive names; Linux is case-sensitive. */
async function caseInsensitive(): Promise<boolean> {
  const probe = join(parent, 'probe');
  await mkdir(probe);
  await writeFile(join(probe, 'CaseProbe'), '');
  try { await access(join(probe, 'caseprobe')); return true; }
  catch { return false; }
  finally { await rm(probe, { recursive: true, force: true }); }
}

describe('CRLF Markdown keeps raw-byte revisions', () => {
  const original = '---\r\ntitle: Windows note\r\n---\r\n# Heading\r\n\r\nFirst line\r\nSecond line\r\n';

  it('hashes the exact bytes without normalizing line endings', async () => {
    await writeFile(join(root, 'note.md'), original);
    expect(await revision('note.md')).toBe(sha256(original));
    expect(await revision('note.md')).not.toBe(sha256(original.replaceAll('\r\n', '\n')));
  });

  it('replaces one literal match and preserves every other CRLF byte', async () => {
    await writeFile(join(root, 'note.md'), original);
    const before = await revision('note.md');
    const result = await run('edit', ['note.md'], { 'if-match': before, find: 'First line', replace: 'Changed line' }) as { changes: Array<{ revision: string }> };
    const expected = original.replace('First line', 'Changed line');
    const bytes = await readFile(join(root, 'note.md'));
    expect(bytes.toString('utf8')).toBe(expected);
    expect(bytes.toString('utf8').split('\r\n')).toHaveLength(original.split('\r\n').length);
    expect(/(?<!\r)\n/.test(bytes.toString('utf8'))).toBe(false);
    expect(result.changes[0]!.revision).toBe(sha256(expected));
    expect(await revision('note.md')).toBe(sha256(expected));
    await expect(run('edit', ['note.md'], { 'if-match': before, find: 'Changed', replace: 'Stale' })).rejects.toMatchObject({ code: 'CONFLICT', details: { path: 'note.md', expectedRevision: before, currentRevision: sha256(expected) } });
  });

  it('matches line endings literally: CRLF find text applies, an LF-only find text leaves the file untouched', async () => {
    await writeFile(join(root, 'note.md'), original);
    await expect(run('edit', ['note.md'], { 'if-match': await revision('note.md'), find: 'First line\nSecond line', replace: 'Joined' })).rejects.toMatchObject({ code: 'NO_MATCH', exitCode: 2, details: { find: 'First line\nSecond line', matches: 0 } });
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe(original);
    await run('edit', ['note.md'], { 'if-match': await revision('note.md'), find: 'First line\r\nSecond line', replace: 'Joined' });
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe(original.replace('First line\r\nSecond line', 'Joined'));
  });

  it('appends supplied text verbatim without rewriting existing line endings', async () => {
    await writeFile(join(root, 'note.md'), original);
    await run('edit', ['note.md'], { 'if-match': await revision('note.md'), append: true, content: 'Appended\r\n' });
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe(`${original}Appended\r\n`);
  });

  it('retains CRLF body text when properties are edited', async () => {
    await writeFile(join(root, 'note.md'), original);
    await run('properties', ['note.md'], { 'if-match': await revision('note.md'), set: '{"status":"done"}' });
    const text = await readFile(join(root, 'note.md'), 'utf8');
    expect(text).toContain('status: done');
    expect(text.endsWith('# Heading\r\n\r\nFirst line\r\nSecond line\r\n')).toBe(true);
  });
});

describe('names differing only in letter case', () => {
  it('never silently overwrites an existing file through a case-variant path', async () => {
    const insensitive = await caseInsensitive();
    await writeFile(join(root, 'note.md'), 'lower case original\n');
    const created = run('write', ['Note.md'], { content: 'upper case\n' });
    if (insensitive) {
      // The case-variant name resolves to the existing file, which requires its revision.
      await expect(created).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await readdir(root)).toEqual(['note.md']);
    } else {
      await expect(created).resolves.toMatchObject({ changes: [{ path: 'Note.md', operation: 'created' }] });
      expect((await readdir(root)).sort()).toEqual(['Note.md', 'note.md']);
      expect(await readFile(join(root, 'Note.md'), 'utf8')).toBe('upper case\n');
    }
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('lower case original\n');
  });

  it('rejects a batch creating two case variants on case-insensitive filesystems and rolls back', async () => {
    const insensitive = await caseInsensitive();
    const batch = context.workspace.write([{ path: 'docs/a.md', bytes: encodeText('first\n') }, { path: 'docs/A.md', bytes: encodeText('second\n') }]);
    if (insensitive) {
      // The second rename is rechecked against the first file and refused; the first creation is undone.
      await expect(batch).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await readdir(root)).toEqual([]);
    } else {
      await expect(batch).resolves.toMatchObject({ changes: [{ path: 'docs/a.md', operation: 'created' }, { path: 'docs/A.md', operation: 'created' }] });
      expect(await readFile(join(root, 'docs/a.md'), 'utf8')).toBe('first\n');
      expect(await readFile(join(root, 'docs/A.md'), 'utf8')).toBe('second\n');
    }
  });
});
