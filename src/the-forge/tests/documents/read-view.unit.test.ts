import { describe, expect, it } from 'vitest';
import { defaultReadBytes, readView } from '../../src/presentation/documents/read-view.ts';

type ReadResult = Parameters<typeof readView>[0];
const read = (document: Record<string, unknown>) => ({ path: 'notes/broken.md', revision: 'r', bytes: 20, document }) as unknown as ReadResult;
const issue = { code: 'INVALID_YAML', message: 'Frontmatter is not valid YAML.' };

describe('read view of a note whose frontmatter does not parse', () => {
  it('keeps the issue that explains null properties, whichever parts are selected', () => {
    const document = { kind: 'markdown', content: '---\nvalue: [\n---\nText\n', properties: null, body: 'Text\n', issue };
    expect(readView(read(document), { maxBytes: defaultReadBytes }, () => {}).document).toEqual({ kind: 'markdown', content: document.content, properties: null, issue });
    expect(readView(read(document), { parts: new Set(['body']), maxBytes: defaultReadBytes }, () => {}).document).toEqual({ kind: 'markdown', body: 'Text\n', issue });
  });

  it('returns no body when unclosed frontmatter leaves none to tell apart', () => {
    const document = { kind: 'markdown', content: '---\nvalue: [\n', properties: null, issue };
    expect(readView(read(document), { parts: new Set(['content', 'body']), maxBytes: defaultReadBytes }, () => {}).document).toEqual({ kind: 'markdown', content: '---\nvalue: [\n', issue });
  });
});

describe('read view of a truncated text', () => {
  const text = (content: string) => ({ path: 'data/big.json', revision: 'r', bytes: Buffer.byteLength(content), document: { kind: 'text', content } }) as unknown as ReadResult;
  const warnings = (content: string, selection: Parameters<typeof readView>[1]) => {
    const recorded: unknown[] = [];
    readView(text(content), selection, message => recorded.push(message));
    return recorded;
  };

  it('continues after the last whole line it returned', () => {
    expect(warnings('one\ntwo\nthree\n', { maxBytes: 8 })).toEqual([{ code: 'READ_TRUNCATED', params: { path: 'data/big.json', start: 1, end: 2, total: 3, returned: 8, bytes: 14, next: 3 } }]);
  });

  it('asks for a larger --max-bytes, never the same --lines, when one line alone exceeds the limit', () => {
    const line = `${'x'.repeat(300)}\n`, content = `head\n${line}tail\n`;
    // The first line alone, and a range starting at the long line: following a --lines hint would return the same prefix.
    expect(warnings(line, { maxBytes: 100 })).toEqual([{ code: 'READ_LINE_TRUNCATED', params: { path: 'data/big.json', start: 1, total: 1, returned: 100, bytes: 301, lineBytes: 301 } }]);
    expect(warnings(content, { maxBytes: 100, lines: { start: 2 } })).toEqual([{ code: 'READ_LINE_TRUNCATED', params: { path: 'data/big.json', start: 2, total: 3, returned: 100, bytes: 311, lineBytes: 301 } }]);
    const whole = readView(text(content), { maxBytes: 301, lines: { start: 2, end: 2 } }, () => { throw new Error('no warning expected'); });
    expect(whole.document).toEqual({ kind: 'text', content: line });
  });
});
