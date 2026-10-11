import { describe, expect, it } from 'vitest';
import type { LinkResolution } from '../../src/domain/metadata/link-resolution.ts';
import { decodeOutcome, decodeResolution, encodeOutcome, encodeResolution, type ParseOutcome, type StoredOutcome } from '../../src/domain/metadata/snapshot-encoding.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { ObsidianMetadataParser } from '../../src/infrastructure/metadata/parser.ts';

const parser = new ObsidianMetadataParser(new ObsidianDocuments());
const parse = (path: string, text: string): ParseOutcome => ({ metadata: parser.parse(path, new TextEncoder().encode(text)) });
/** What a later invocation reads back: the encoded outcome after a JSON round trip. */
const stored = (outcome: ParseOutcome) => JSON.parse(JSON.stringify(encodeOutcome(outcome))) as StoredOutcome;

const note = [
  '---', 'aliases: [Roadmap]', 'tags: [work]', 'related: ["[[Plan#Scope]]", "![[diagram.png]]"]', '---',
  '# Title with [[Inline]]', '', 'See [[Plan#Scope|the scope]], ![[Sketch.canvas]] and [doc](../Docs/Read%20Me.md#Intro) #tag/one.',
  'Ref [text][spec] and [[Plan#^block-1]].', '', '[spec]: Specs/Spec.md', '', '## Tasks', '', '- [ ] open task ^task-1', '  - [x] nested done',
  '- plain item', '', 'Paragraph with block ^para-1', '', '> [!note] Callout', '',
].join('\n');
const canvas = JSON.stringify({ nodes: [{ id: 'n1', type: 'file', file: 'Notes/Plan.md', x: 0, y: 0, width: 1, height: 1 }], edges: [] });

describe('stored parse outcomes', () => {
  it('stores positions as indexes into one number list and decodes exactly the parsed metadata', () => {
    for (const [path, text] of [['Note.md', note], ['Board.canvas', canvas], ['Empty.md', ''], ['Front.md', '---\na: 1\n---\n']] as const) {
      const outcome = parse(path, text);
      const encoded = stored(outcome);
      expect(decodeOutcome(encoded), path).toStrictEqual(outcome);
    }
    const encoded = encodeOutcome(parse('Note.md', note));
    expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(parse('Note.md', note)).length * 0.7);
    expect(JSON.stringify(encoded)).not.toContain('"offset"');
  });

  it('keeps issues as they are', () => {
    const issue = { issue: { code: 'INVALID_YAML', message: 'broken' } };
    expect(encodeOutcome(issue)).toEqual(issue);
    expect(decodeOutcome(issue)).toEqual(issue);
  });

  it('rejects position indexes that the stored list does not hold, so the file is parsed again', () => {
    const outcome = parse('Note.md', note);
    const tamper = (change: (value: { metadata: Record<string, unknown>; positions: number[] }) => void) => {
      const value = stored(outcome) as { metadata: Record<string, unknown>; positions: number[] };
      change(value);
      return decodeOutcome(value);
    };
    expect(tamper(value => { value.positions.pop(); })).toBeUndefined();
    expect(tamper(value => { (value.metadata.links as Array<{ position: unknown }>)[0]!.position = 10_000; })).toBeUndefined();
    expect(tamper(value => { (value.metadata.headings as Array<{ position: unknown }>)[0]!.position = 0.5; })).toBeUndefined();
    expect(tamper(value => { (value.metadata.tags as Array<{ position: unknown }>)[0]!.position = { start: 0 }; })).toBeUndefined();
    expect(tamper(value => { value.metadata.frontmatterPosition = -1; })).toBeUndefined();
    expect(tamper(value => { (Object.values(value.metadata.blocks as object)[0] as { position: unknown }).position = '1'; })).toBeUndefined();
    expect(tamper(value => { value.metadata.sections = 'none'; })).toBeUndefined();
  });
});

describe('stored link resolutions', () => {
  const paths = ['Notes/Plan.md', 'Notes/plan.md', 'People/Ada.md'];
  const index = (path: string) => paths.indexOf(path);

  it('round-trips every kind of resolution against the stored vault paths', () => {
    const resolutions: LinkResolution[] = [
      { status: 'resolved', path: 'Notes/Plan.md', via: 'path' },
      { status: 'resolved', path: 'People/Ada.md', via: 'path' },
      { status: 'resolved', path: 'Notes/Plan.md', via: 'alias' },
      { status: 'resolved', path: 'People/Ada.md', via: 'alias' },
      { status: 'unresolved', linkpath: 'Missing', reason: 'missing' },
      { status: 'unresolved', linkpath: 'plan', reason: 'ambiguous', via: 'path', candidates: ['Notes/Plan.md', 'Notes/plan.md'] },
      { status: 'unresolved', linkpath: 'Ada', reason: 'ambiguous', via: 'alias', candidates: ['Notes/plan.md', 'People/Ada.md'] },
      { status: 'external' },
    ];
    for (const resolution of resolutions) {
      const encoded = JSON.parse(JSON.stringify(encodeResolution(resolution, index)));
      expect(decodeResolution(encoded, paths), JSON.stringify(resolution)).toEqual(resolution);
    }
    expect(encodeResolution({ status: 'resolved', path: 'Notes/Plan.md', via: 'path' }, index)).toBe(0);
    expect(encodeResolution({ status: 'external' }, index)).toBeNull();
  });

  it('rejects malformed stored resolutions', () => {
    for (const value of [3, -4, 1.5, 'x', ['missing'], ['missing', 'a', 1], ['path', 'a', 0], ['path', 'a', 0, 9], ['other', 'a', 0, 1], [], {}, ['alias', 7, 0, 1]]) {
      expect(decodeResolution(value as never, paths), JSON.stringify(value)).toBeUndefined();
    }
  });
});
