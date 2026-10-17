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
