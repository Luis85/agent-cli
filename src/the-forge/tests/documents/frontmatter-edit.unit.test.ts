import { describe, expect, it } from 'vitest';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';

const codec = new ObsidianDocuments();
const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
const properties = (text: string, changes: Record<string, unknown>, remove: string[] = []) => decode(codec.properties(encodeText(text), changes, remove));

describe('minimal frontmatter edits', () => {
  it.each(['body', '---\n---\nbody'])('writes new frontmatter of %j in block style', note => {
    expect(properties(note, { tag: 'b' })).toBe('---\ntag: b\n---\nbody');
    expect(properties(note, { status: 'draft', tags: ['a', 'b'] })).toBe('---\nstatus: draft\ntags:\n  - a\n  - b\n---\nbody');
  });

  it('keeps every untouched byte of the frontmatter when it sets, adds and removes keys', () => {
    const yaml = '# keep me\ntags: [a,  b]\nhex: 0x1F\nlist:\n- x\n- y\nfold: >\n  long\n  text\nstatus: "draft" # state\nowner: me\n';
    const note = `---\n${yaml}---\n# Body\n`;
    expect(properties(note, { status: 'done' })).toBe(note.replace('"draft"', 'done'));
    expect(properties(note, { added: [1, 2] })).toBe(`---\n${yaml}added:\n  - 1\n  - 2\n---\n# Body\n`);
    expect(properties(note, {}, ['list', 'owner'])).toBe(note.replace('list:\n- x\n- y\n', '').replace('owner: me\n', ''));
    expect(properties(note, { list: ['z'] })).toBe(note.replace('list:\n- x\n- y\n', 'list:\n  - z\n'));
    expect(properties(note, { status: 'line one\nline two' })).toBe(note.replace('status: "draft" # state\n', 'status: |-\n  line one\n  line two\n'));
  });

  it('leaves a note byte-identical when every value already matches', () => {
    const note = '---\ntags: [a,  b]\nstatus: draft\n---\nBody\n';
    expect(properties(note, { tags: ['a', 'b'], status: 'draft' }, ['missing'])).toBe(note);
  });

  it('keeps CRLF line endings and a BOM in minimal edits', () => {
    const note = '﻿---\r\ntags: [a, b]\r\nstatus: draft\r\n---\r\nBody\r\n';
    expect(properties(note, { status: 'done', owner: 'me' })).toBe('﻿---\r\ntags: [a, b]\r\nstatus: done\r\nowner: me\r\n---\r\nBody\r\n');
  });

  it('stores null as YAML null and removes keys only through unset', () => {
    const note = '---\nowner: me\n---\nBody\n';
    expect(properties(note, { owner: null })).toBe('---\nowner: null\n---\nBody\n');
    expect(properties(note, {}, ['owner'])).toBe('---\n---\nBody\n');
  });

  it('serializes the whole frontmatter without padding flow brackets when a minimal edit cannot apply', () => {
    // A flow mapping at the top level, and indented keys that an appended key would not line up with.
    expect(properties('---\n{a: 1, tags: [x, y]}\n---\nBody\n', { b: 2 })).toBe('---\n{a: 1, tags: [x, y], b: 2}\n---\nBody\n');
    expect(properties('---\n  a: 1\n  tags: [x, y]\n---\nBody\n', { b: 2 })).toBe('---\na: 1\ntags: [x, y]\nb: 2\n---\nBody\n');
  });
});
