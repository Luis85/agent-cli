import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { documentCommands } from '../../src/presentation/documents/commands.ts';
import { readManyCommand } from '../../src/presentation/documents/read-many-command.ts';
import { readManyOutput } from '../../src/presentation/documents/read-many-output.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';

let root: string, context: CommandContext, events: EventBus;
const command = readManyCommand();
const single = documentCommands().find(command => command.id === 'read')!;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-read-many-'));
  events = new EventBus(new NodeEventScope()); registerHostEvents(events);
  const workspace = new Workspace(await NodeFiles.at(root), new ObsidianDocuments(), events, false, root);
  context = { workspace, root, workspaceRoot: root, project: null, events } as unknown as CommandContext;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const run = (paths: string[]) => command.run(paths, {}, context);

describe('bounded read-many file inspection', () => {
  it('matches default read representations and revisions for every supported document family', async () => {
    const files: Record<string, string | Buffer> = {
      'note.md': '---\ntitle: Review\n---\n# Note\nText\n', 'module.ts': 'export const answer = 42;\n',
      'binary.bin': Buffer.from([0, 255, 127]), 'invalid.txt': Buffer.from([255, 254]),
      'graph.canvas': '{"nodes":[],"edges":[]}', 'view.base': 'views:\n  - type: table\n    name: Notes\n',
    };
    for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
    const paths = Object.keys(files).reverse();
    const expected = [];
    for (const path of paths) expected.push(await single.run([path], {}, context));
    const result = await run(paths);
    expect(result).toEqual({ files: expected, bytes: Object.values(files).reduce((count, content) => count + Buffer.byteLength(content), 0) });
    expect(validateJsonValue(readManyOutput, result, 'data').issues).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('"body":');
    expect(events.history.some(event => event.id.startsWith('vault.'))).toBe(false);
  });
  it('allows exactly 8 MiB raw bytes even when base64 JSON is larger, then refuses the next byte', async () => {
    await writeFile(join(root, 'a.bin'), Buffer.alloc(4 * 1024 * 1024));
    await writeFile(join(root, 'b.bin'), Buffer.alloc(4 * 1024 * 1024));
    await writeFile(join(root, 'c.bin'), Buffer.from([1]));
    const result = await run(['a.bin', 'b.bin']);
    expect(result).toMatchObject({ bytes: 8 * 1024 * 1024 });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(8 * 1024 * 1024);
    await expect(run(['a.bin', 'b.bin', 'c.bin'])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', details: { index: 2, path: 'c.bin', maxBytes: 8388608, bytes: 8388609 } });
  });
  it('refuses a file over the remaining budget without parsing it or reporting it opened', async () => {
    await writeFile(join(root, 'a.bin'), Buffer.alloc(8 * 1024 * 1024));
    const invalid = '---\nvalue: [\n---\n';
    await writeFile(join(root, 'bad.md'), invalid);
    await expect(run(['a.bin', 'bad.md'])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', details: { index: 1, path: 'bad.md', bytes: 8 * 1024 * 1024 + Buffer.byteLength(invalid) } });
    expect(events.history.filter(event => event.id === 'workspace.file-open').map(event => (event.payload as { path: string }).path)).toEqual(['a.bin']);
  });
  it('fails the bundle at a missing file, reports its index, and does not read later files', async () => {
    await writeFile(join(root, 'valid.txt'), 'read first');
    await expect(run(['valid.txt', 'missing.md', 'never.txt'])).rejects.toMatchObject({ code: 'NOT_FOUND', details: { index: 1, path: 'missing.md' } });
    expect(events.history.filter(event => event.id === 'workspace.file-open')).toHaveLength(1);
  });
  it('returns a note whose frontmatter does not parse with its issue, as read does', async () => {
    await writeFile(join(root, 'bad.md'), '---\nvalue: [\n---\n');
    const inspected = await single.run(['bad.md'], {}, context) as { document: unknown };
    expect(inspected.document).toMatchObject({ kind: 'markdown', properties: null, issue: { code: 'INVALID_YAML' } });
    expect(await run(['bad.md'])).toMatchObject({ files: [{ path: 'bad.md', document: inspected.document }] });
  });
  it.each([
    ['bad.canvas', '{"nodes":', 'INVALID_CANVAS'],
    ['bad.base', 'views: [', 'INVALID_YAML'],
  ])('preserves the existing read error for %s with bundle location', async (path, content, code) => {
    await writeFile(join(root, path), content);
    let expected: unknown;
    try { await single.run([path], {}, context); } catch (error) { expected = error; }
    expect(expected).toMatchObject({ code });
    await expect(run([path])).rejects.toMatchObject({ code, details: { index: 0, path } });
  });
  it('rejects symlink traversal without reading its target', async () => {
    await mkdir(join(root, 'target')); await writeFile(join(root, 'target/note.txt'), 'private');
    await symlink(join(root, 'target'), join(root, 'linked'), 'junction');
    await expect(run(['linked/note.txt'])).rejects.toMatchObject({ code: 'UNSAFE_PATH', details: { index: 0, path: 'linked/note.txt' } });
    expect(events.history.filter(event => event.id === 'workspace.file-open')).toHaveLength(0);
  });
});
