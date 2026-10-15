import { describe, expect, it } from 'vitest';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { fileKind, isStructured, isTextLike } from '../../src/domain/documents/file.ts';
import { editBytes } from '../../src/application/documents/text-edit.ts';

const codec = new ObsidianDocuments();
const invalidUtf8 = new Uint8Array([0x63, 0x6f, 0xff, 0xfe, 0x0a]);
/** BOM-less UTF-16LE: every byte is valid UTF-8, but ASCII characters decode next to U+0000. */
const utf16le = new Uint8Array(Buffer.from('Write-Output "planned"\r\n', 'utf16le'));
const noMetadata = { parseContent: () => { throw new Error('Literal edits do not parse the note.'); } };

describe('UTF-8 text files', () => {
  it.each(['src/x.ts', 'app.TSX', 'lib.mjs', 'lib.cjs', 'types.mts', 'types.cts', 'package.json', 'tsconfig.jsonc', 'ci.yaml', 'ci.yml',
    'Cargo.toml', 'style.css', 'style.scss', 'index.html', 'page.htm', 'feed.xml', 'notes.txt', 'data.csv', 'data.tsv', 'run.sh', 'tool.py', 'schema.sql',
    'deploy.ps1', 'scripts/DEPLOY.PS1', 'modules/Forge.psm1', 'Forge.PSD1',
    'Dockerfile', 'Containerfile', 'dockerfile', 'CONTAINERFILE', 'deploy/DoCkErFiLe', 'containers/Containerfile',
    'Dockerfile.release', 'Dockerfile.prod', 'deploy/CONTAINERFILE.dev', 'Containerfile.release.linux'])('classifies %s as text', path => {
    expect(fileKind(path)).toBe('text');
    expect(isStructured(path)).toBe(false);
    expect(isTextLike(path)).toBe(true);
  });

  it.each([['logo.svg', 'image'], ['.gitignore', 'attachment'], ['.env', 'attachment'], ['Makefile', 'attachment'], ['archive.zip', 'attachment'], ['deploy.ps1.bak', 'attachment'],
    ['.Dockerfile', 'attachment'], ['.Containerfile', 'attachment'],
    ['Dockerfile-extra', 'attachment'], ['Dockerfile/unknown', 'attachment'], ['Containerfile.', 'attachment'], ['Dockerfile.', 'attachment'], ['Dockerfile..', 'attachment'], ['Containerfile..release', 'attachment'], ['deploy/Dockerfile...', 'attachment'], ['Dockerfiles.release', 'attachment'], ['Dockerfile.release/unknown', 'attachment']])('keeps %s as %s', (path, kind) => {
    expect(fileKind(path)).toBe(kind);
    expect(isTextLike(path)).toBe(false);
  });

  it.each(['src/x.ts', 'scripts/deploy.ps1', 'Dockerfile', 'build/Containerfile', 'Dockerfile.release', 'build/Containerfile.dev'])('reads %s with a BOM and CRLF as lossless text content', path => {
    const source = '﻿export const answer = 42;\r\n// café\r\n';
    expect(codec.inspect(path, encodeText(source))).toEqual({ kind: 'text', content: source });
  });

  it.each(['src/x.ts', 'scripts/deploy.ps1', 'Dockerfile', 'build/Containerfile', 'Dockerfile.release', 'build/Containerfile.dev'])('falls back to base64 when %s bytes are not UTF-8', path => {
    expect(codec.inspect(path, invalidUtf8)).toEqual({ kind: 'attachment', encoding: 'base64', content: Buffer.from(invalidUtf8).toString('base64') });
  });

  it.each(['scripts/deploy.ps1', 'modules/Forge.psm1', 'src/x.ts', 'Dockerfile'])('treats BOM-less UTF-16LE %s as binary rather than text', path => {
    expect(codec.inspect(path, utf16le)).toEqual({ kind: 'attachment', encoding: 'base64', content: Buffer.from(utf16le).toString('base64') });
    expect(() => codec.validate(path, utf16le)).toThrow(expect.objectContaining({ code: 'INVALID_ENCODING' }));
    expect(() => editBytes(path, utf16le, { kind: 'append', content: '# new\n' }, noMetadata)).toThrow(expect.objectContaining({ code: 'INVALID_ENCODING' }));
    expect(() => codec.validate(path, encodeText('one\u0000two\n'))).toThrow(expect.objectContaining({ code: 'INVALID_ENCODING' }));
  });

  it('keeps the NUL rule to text files whose kind is only an extension hint', () => {
    expect(codec.inspect('note.md', encodeText('# A\u0000B\n'))).toMatchObject({ kind: 'markdown', content: '# A\u0000B\n' });
    expect(new TextDecoder().decode(editBytes('src/x.ts', encodeText('export {};\n'), { kind: 'append', content: '// done\n' }, noMetadata))).toBe('export {};\n// done\n');
  });

  it('rejects text edits whose result would contain NUL characters, but not in Markdown', () => {
    const source = encodeText('one\ntwo\n');
    expect(() => editBytes('notes.txt', source, { kind: 'replace', find: 'two', replace: 'tw\u0000o' }, noMetadata)).toThrow(expect.objectContaining({ code: 'INVALID_ENCODING' }));
    expect(() => editBytes('src/x.ts', source, { kind: 'append', content: '\u0000' }, noMetadata)).toThrow(expect.objectContaining({ code: 'INVALID_ENCODING' }));
    expect(new TextDecoder().decode(editBytes('note.md', source, { kind: 'append', content: 'a\u0000b\n' }, noMetadata))).toBe('one\ntwo\na\u0000b\n');
  });

  it('validates text as UTF-8 without interpreting its syntax', () => {
    expect(() => codec.validate('broken.json', encodeText('{ "unterminated": '))).not.toThrow();
    for (const path of ['src/x.ts', 'scripts/deploy.ps1', 'Dockerfile', 'Containerfile', 'Dockerfile.release', 'Containerfile.dev']) {
      expect(() => codec.validate(path, invalidUtf8)).toThrow(expect.objectContaining({ code: 'INVALID_ENCODING' }));
    }
  });

  it.each([['Dockerfile.md', 'markdown'], ['Containerfile.CANVAS', 'canvas'], ['Dockerfile.prod.base', 'base'],
    ['Dockerfile.png', 'image'], ['Containerfile.release.pdf', 'pdf']])('preserves the native kind of %s', (path, kind) => {
    expect(fileKind(path)).toBe(kind);
  });

  it('keeps Markdown reads complete for codec consumers', () => {
    expect(codec.inspect('note.md', encodeText('---\nstatus: draft\n---\n# Body\n'))).toEqual({ kind: 'markdown', content: '---\nstatus: draft\n---\n# Body\n', properties: { status: 'draft' }, body: '# Body\n' });
  });
});
