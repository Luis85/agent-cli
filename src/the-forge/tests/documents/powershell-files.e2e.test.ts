import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;

describe('PowerShell source through the portable CLI', () => {
  it('reads, discovers, previews and edits UTF-8 scripts while preserving BOM and CRLF', async () => {
    const path = 'scripts/deploy.PS1';
    const source = '\uFEFF# PowerShell-marker café\r\nWrite-Output "planned"\r\n';
    expect((await cli(['create', path, '--stdin'], source)).status).toBe(0);
    const read = await cli(['read', path]);
    expect(read.status).toBe(0);
    expect(read.body.data.document).toEqual({ kind: 'text', content: source });
    expect((await cli(['formats'])).body.data.text).toContain('ps1');
    expect((await cli(['list', '--path', path, '--kind', 'text'])).body.data.files).toEqual([{ path, kind: 'text' }]);
    const search = await cli(['search', 'PowerShell-marker', '--kind', 'text']);
    expect(search.body.data.hits.map((hit: { path: string }) => hit.path)).toEqual([path]);

    const content = source.replace('planned', 'ready');
    const plan = JSON.stringify({ version: 1, operations: [{ op: 'write', path, content, ifMatch: read.body.data.revision }] });
    const preview = await cli(['apply', '-', '--dry-run'], plan);
    expect(preview.status).toBe(0);
    expect(preview.body.data.changes[0].diff).toContain('-Write-Output "planned"');
    expect(preview.body.data.changes[0].diff).toContain('+Write-Output "ready"');
    expect(await readFile(join(fixture.project, path), 'utf8')).toBe(source);

    const edit = await cli(['edit', path, '--find', 'planned', '--replace', 'ready', '--if-match', read.body.data.revision]);
    expect(edit.status).toBe(0);
    expect(await readFile(join(fixture.project, path))).toEqual(Buffer.from(content));
    expect((await cli(['validate', path])).body.data).toMatchObject({ valid: true, kind: 'text', validation: 'utf8' });
  });

  it.each([
    ['malformed.ps1', Buffer.from([0x23, 0x20, 0xff, 0x0a])],
    ['utf16.ps1', Buffer.from('\uFEFFWrite-Output "planned"\r\n', 'utf16le')],
    ['utf16-no-bom.ps1', Buffer.from('Write-Output "planned"\r\n', 'utf16le')],
    ['src/utf16-no-bom.ts', Buffer.from('export const planned = true;\n', 'utf16le')],
  ])('keeps %s lossless and refuses text edits when its bytes are not UTF-8 text', async (path, bytes) => {
    expect((await cli(['write', path, '--stdin'], bytes)).status).toBe(0);
    const read = await cli(['read', path]);
    expect(read.body.data.document).toEqual({ kind: 'attachment', encoding: 'base64', content: bytes.toString('base64') });
    const validation = await cli(['validate', path]);
    expect(validation.status).toBe(2);
    expect(validation.body.error.code).toBe('INVALID_ENCODING');
    const edit = await cli(['edit', path, '--append', '--content', '# new\n', '--if-match', read.body.data.revision]);
    expect(edit.status).toBe(2);
    expect(edit.body.error.code).toBe('INVALID_ENCODING');
    expect(await readFile(join(fixture.project, path))).toEqual(bytes);
  });

  it.each(['modules/Forge.psm1', 'modules/Forge.PSD1'])('treats module file %s as UTF-8 text', async path => {
    const source = '\uFEFF# module café\r\n@{ ModuleVersion = "1.0" }\r\n';
    expect((await cli(['create', path, '--stdin'], source)).status).toBe(0);
    const read = await cli(['read', path]);
    expect(read.body.data.document).toEqual({ kind: 'text', content: source });
    expect((await cli(['validate', path])).body.data).toMatchObject({ valid: true, kind: 'text', validation: 'utf8' });
    expect((await cli(['edit', path, '--append', '--content', '# end\n', '--if-match', read.body.data.revision])).status).toBe(0);
    expect(await readFile(join(fixture.project, path), 'utf8')).toBe(`${source}# end\n`);
  });
});
