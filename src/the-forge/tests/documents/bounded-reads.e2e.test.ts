import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { warningMessages } from '../support/warnings.ts';

const fixture = portableCli();
const cli = fixture.cli;
const put = async (path: string, content: string | Buffer) => {
  await mkdir(dirname(join(fixture.project, path)), { recursive: true });
  await writeFile(join(fixture.project, path), content);
};
const paths = (body: { data: { files: Array<{ path: string }> } }) => body.data.files.map(file => file.path);
const workflowTimeout = 60_000;

describe('bounded, targeted reads for agents', () => {
  it('lists a folder path recursively, warns when a path matches nothing and hides .trash by default', async () => {
    await put('vault/notes/a.md', '---\nstatus: open\ntags: [project/alpha]\n---\n# A\n');
    await put('vault/notes/deep/b.md', '---\nstatus: done\n---\n# B #project\n');
    await put('vault/specs/plan.md', 'plan\n');
    await put('.trash/old.md', '---\nstatus: open\n---\nold\n');
    for (const path of ['vault/notes', 'vault/notes/']) {
      const listed = await cli(['list', '--path', path]);
      expect(listed.body.warnings).toEqual([]);
      expect(paths(listed.body)).toEqual(['vault/notes/a.md', 'vault/notes/deep/b.md']);
      expect(listed.body.data.total).toBe(2);
    }
    const missing = await cli(['list', '--path', 'vault/Notes']);
    expect(missing.status).toBe(0);
    expect(missing.body.data).toEqual({ files: [], total: 0 });
    expect(missing.body.warnings).toEqual([{ code: 'PATH_MATCHED_NOTHING', message: expect.stringMatching(/^--path vault\/Notes matched no file in this scope\. .*run list/), details: { option: '--path', pattern: 'vault/Notes' } }]);
    const german = await cli(['--lang', 'de', 'list', '--path', 'vault/Notes']);
    expect(warningMessages(german.body)).toEqual([expect.stringMatching(/^--path vault\/Notes trifft in diesem Bereich keine Datei\./)]);
    expect(paths((await cli(['list'])).body)).not.toContain('.trash/old.md');
    expect(paths((await cli(['list', '--include-trash'])).body)).toContain('.trash/old.md');
    expect(paths((await cli(['list', '--path', '.trash'])).body)).toEqual(['.trash/old.md']);
    // Notes by property or tag, without a search pattern; .trash stays hidden from the metadata filters too.
    expect(paths((await cli(['list', '--property', 'status=open'])).body)).toEqual(['vault/notes/a.md']);
    expect(paths((await cli(['list', '--tag', 'project', '--path', 'vault'])).body)).toEqual(['vault/notes/a.md', 'vault/notes/deep/b.md']);
    expect(paths((await cli(['list', '--property', 'status', '--tag', 'project/alpha'])).body)).toEqual(['vault/notes/a.md']);
    expect((await cli(['list', '--property', '=x'])).body.error).toMatchObject({ code: 'INVALID_ARGUMENT', message: '--property must be key or key=value with a nonempty key.' });
    const searched = await cli(['search', 'plan', '--path', 'vault/specs']);
    expect(searched.body.data.hits.map((hit: { path: string }) => hit.path)).toEqual(['vault/specs/plan.md']);
    expect((await cli(['search', 'plan', '--path', 'vault/spec'])).body.warnings).toEqual([expect.objectContaining({ code: 'PATH_MATCHED_NOTHING', message: expect.stringContaining('--path vault/spec matched no file') })]);
    expect((await cli(['search', 'status', '--count'])).body.data).toEqual({ total: 2, fileCount: 2 });
    expect((await cli(['search', 'status', '--files-only', '--limit', '1'])).body.data).toMatchObject({ files: [{ path: 'vault/notes/a.md', hits: 1 }], total: 2, fileCount: 2, nextCursor: expect.any(String) });
    expect((await cli(['search', 'status', '--count', '--files-only'])).body.error.code).toBe('INVALID_ARGUMENT');
    expect((await cli(['links', 'deadends', '--path', 'vault/nothing'])).body.warnings).toEqual([expect.objectContaining({ code: 'PATH_MATCHED_NOTHING', details: { option: '--path', pattern: 'vault/nothing' } })]);
    expect((await cli(['vault', 'tags', '--path', 'vault/notes'])).body.warnings).toEqual([]);
  }, workflowTimeout);

  it('pages list by default with total and a cursor', async () => {
    for (let index = 0; index < 501; index++) await put(`many/${String(index).padStart(3, '0')}.txt`, '');
    const first = await cli(['list', '--path', 'many']);
    expect(first.body.data.files).toHaveLength(500);
    expect(first.body.data).toMatchObject({ total: 501, nextCursor: expect.any(String) });
    const last = await cli(['list', '--path', 'many', '--cursor', first.body.data.nextCursor]);
    expect(paths(last.body)).toEqual(['many/500.txt']);
    expect(last.body.data).not.toHaveProperty('nextCursor');
  }, workflowTimeout);

  it('truncates long content with a hint, reads line ranges and selects only the requested parts', async () => {
    const lines = Array.from({ length: 40_000 }, (_, index) => `line ${index + 1}\n`).join('');
    await put('big.md', `---\nstatus: big\n---\n${lines}`);
    const read = await cli(['read', 'big.md']);
    expect(read.status).toBe(0);
    expect(read.stdout.length).toBeLessThan(300_000);
    expect(read.body.data).toMatchObject({ truncated: true, bytes: Buffer.byteLength(`---\nstatus: big\n---\n${lines}`), lines: { start: 1, total: 40_003 }, document: { properties: { status: 'big' } } });
    const { end } = read.body.data.lines;
    expect(read.body.warnings.map((warning: { code: string }) => warning.code)).toEqual(['READ_TRUNCATED']);
    expect(read.body.warnings[0].details).toMatchObject({ path: 'big.md', start: 1, end, total: 40_003, next: end + 1 });
    expect(warningMessages(read.body)).toEqual([expect.stringMatching(new RegExp(`^big\\.md was truncated to lines 1-${end} of 40003 .*--lines ${end + 1}-`))]);
    const range = await cli(['read', 'big.md', '--lines', '5-7']);
    expect(range.body.data).toMatchObject({ lines: { start: 5, end: 7, total: 40_003 }, document: { content: 'line 2\nline 3\nline 4\n' } });
    expect(range.body.data).not.toHaveProperty('truncated');
    expect(range.body.warnings).toEqual([]);
    expect((await cli(['read', 'big.md', '--lines', '40003-'])).body.data.document.content).toBe('line 40000\n');
    expect((await cli(['read', 'big.md', '--lines', '40004'])).body.error).toMatchObject({ code: 'INVALID_ARGUMENT', details: { total: 40_003 } });
    expect((await cli(['read', 'big.md', '--max-bytes', '20'])).body.data).toMatchObject({ truncated: true, document: { content: '---\nstatus: big\n---\n' } });
    const properties = await cli(['read', 'big.md', '--parts', 'properties']);
    expect(properties.body.data.document).toEqual({ kind: 'markdown', properties: { status: 'big' } });
    expect(properties.body.data).not.toHaveProperty('truncated');
    await put('small.md', '---\na: 1\n---\nBody\n');
    expect((await cli(['read', 'small.md', '--parts', 'body'])).body.data.document).toEqual({ kind: 'markdown', body: 'Body\n' });
    expect((await cli(['read', 'small.md'])).body.data).toEqual({ path: 'small.md', revision: expect.any(String), bytes: 18, document: { kind: 'markdown', content: '---\na: 1\n---\nBody\n', properties: { a: 1 } } });
    expect((await cli(['read', 'small.md', '--parts', 'body', '--lines', '1'])).body.error.code).toBe('INVALID_ARGUMENT');
    await put('image.png', Buffer.alloc(300_000, 1));
    const image = await cli(['read', 'image.png']);
    expect(image.body.data).toMatchObject({ truncated: true, bytes: 300_000 });
    expect(Buffer.from(image.body.data.document.content, 'base64')).toHaveLength(262_144);
    expect((await cli(['read', 'image.png', '--lines', '1-2'])).body.error).toMatchObject({ code: 'INVALID_ARGUMENT', message: '--lines requires a Markdown or UTF-8 text file.' });
  }, workflowTimeout);

  it('publishes a compact schema index and the full contract with --all', async () => {
    const index = await cli(['schema']);
    expect(index.status).toBe(0);
    expect(index.stdout.length).toBeLessThan(20_000);
    expect(index.body.data.commands).toContainEqual({ id: 'read', description: expect.any(String) });
    expect(index.body.data.more).toContain('schema --all');
    const all = await cli(['schema', '--all']);
    expect(all.body.data.commands.find((command: { id: string }) => command.id === 'read')).toHaveProperty('inputSchema');
    expect(all.body.data.errors.length).toBeGreaterThan(50);
    expect((await cli(['schema', 'read', '--all'])).body.error.code).toBe('INVALID_ARGUMENT');
    expect((await cli(['--lang', 'de', 'schema'])).body.data.more).toContain('schema --all');
  }, workflowTimeout);
});
