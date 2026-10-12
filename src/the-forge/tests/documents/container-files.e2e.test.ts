import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { applyUnifiedDiff } from '../support/unified-diff.ts';

const fixture = portableCli();
const cli = fixture.cli;
const workflowTimeout = 30_000;

describe('container build files through the portable CLI', () => {
  it.each(['Dockerfile', 'deploy/cOnTaInErFiLe'])('reads, previews and edits %s without changing its encoding or line endings', async path => {
    const source = '\uFEFFFROM node:22\r\n# café\r\n';
    expect((await cli(['create', path, '--stdin'], source)).status).toBe(0);
    const read = await cli(['read', path]);
    expect(read.status).toBe(0);
    expect(read.body.data.document).toEqual({ kind: 'text', content: source });
    const { revision } = read.body.data;
    const args = ['edit', path, '--find', 'node:22', '--replace', 'node:24', '--if-match', revision];
    const preview = await cli([...args, '--dry-run']);
    expect(preview.status).toBe(0);
    expect(preview.body.events).toEqual([]);
    const diff = preview.body.data.changes[0].diff;
    expect(diff).toContain(`--- a/${path}\n+++ b/${path}\n`);
    expect(applyUnifiedDiff(source, diff)).toBe(source.replace('node:22', 'node:24'));
    expect(await readFile(join(fixture.project, path))).toEqual(Buffer.from(source));
    expect((await cli(args)).status).toBe(0);
    expect(await readFile(join(fixture.project, path))).toEqual(Buffer.from(source.replace('node:22', 'node:24')));
    const stale = await cli(args);
    expect(stale.status).toBe(2);
    expect(stale.body.error.code).toBe('CONFLICT');
    expect((await cli(['validate', path])).body.data).toMatchObject({ valid: true, kind: 'text', validation: 'utf8' });
  }, workflowTimeout);

  it('discovers the exact basenames and lists and searches them while keeping unknown names opaque', async () => {
    const formats = await cli(['formats']);
    expect(formats.status).toBe(0);
    expect(formats.body.data.textFilenames).toEqual(['Dockerfile', 'Containerfile']);
    expect(formats.body.data.text).toContain('ts');
    const content = 'FROM unique-container-image\n';
    for (const path of ['images/DOCKERFILE', 'images/Containerfile', 'images/Dockerfile.prod', 'images/Makefile', 'images/.Dockerfile']) {
      expect((await cli(['create', path, '--stdin'], content)).status).toBe(0);
    }
    const listed = await cli(['list', '--path', 'images/**', '--kind', 'text']);
    expect(listed.status).toBe(0);
    expect(listed.body.data.files).toEqual([
      { path: 'images/Containerfile', kind: 'text' }, { path: 'images/DOCKERFILE', kind: 'text' },
    ]);
    const search = await cli(['search', 'unique-container-image', '--kind', 'text']);
    expect(search.status).toBe(0);
    expect(search.body.data.hits.map((hit: { path: string }) => hit.path)).toEqual(['images/Containerfile', 'images/DOCKERFILE']);
    const opaque = await cli(['read', 'images/Dockerfile.prod']);
    expect(opaque.body.data.document).toEqual({ kind: 'attachment', encoding: 'base64', content: Buffer.from(content).toString('base64') });
    const edit = await cli(['edit', 'images/Dockerfile.prod', '--append', '--content', '# comment\n', '--if-match', opaque.body.data.revision]);
    expect(edit.status).toBe(2);
    expect(edit.body.error.code).toBe('UNSUPPORTED_EDIT');
  }, workflowTimeout);

  it('reads malformed UTF-8 losslessly and refuses literal edits without modifying its bytes', async () => {
    const path = 'invalid/Containerfile';
    const bytes = Buffer.from([0x46, 0x52, 0x4f, 0x4d, 0x20, 0xff, 0x0a]);
    expect((await cli(['write', path, '--stdin'], bytes)).status).toBe(0);
    const read = await cli(['read', path]);
    expect(read.status).toBe(0);
    expect(read.body.data.document).toEqual({ kind: 'attachment', encoding: 'base64', content: bytes.toString('base64') });
    const validation = await cli(['validate', path]);
    expect(validation.status).toBe(2);
    expect(validation.body.error.code).toBe('INVALID_ENCODING');
    const edit = await cli(['edit', path, '--find', 'FROM', '--replace', 'ARG', '--if-match', read.body.data.revision]);
    expect(edit.status).toBe(2);
    expect(edit.body.error.code).toBe('INVALID_ENCODING');
    expect(await readFile(join(fixture.project, path))).toEqual(bytes);
  }, workflowTimeout);
});
