import { describe, expect, it } from 'vitest';
import { MemoryFiles, metadataIndex } from '../support/metadata.ts';
import { planLinkUpdates, rewriteText } from '../../src/application/vault/link-plan.ts';
import { applyEdits, markdownDestination, definitionDestination, attributeDestination, relativePath } from '../../src/domain/metadata/link-text.ts';

/** Plans a move over an in-memory vault and returns every rewritten file's new text, keyed by its old path. */
async function rewritten(vault: Record<string, string>, moves: Record<string, string>) {
  const files = new MemoryFiles(vault);
  const cache = await metadataIndex(files).load();
  const plan = planLinkUpdates(cache, new Map(Object.entries(moves)));
  const texts: Record<string, string> = {};
  for (const file of plan.files) texts[file.source] = rewriteText(file, vault[file.source]!, cache.getFileCache(file.source)!)!.text;
  return { texts, plan };
}

describe('link text helpers', () => {
  it('computes POSIX relative paths between folders', () => {
    expect(relativePath('.', 'specs/Plan.md')).toBe('specs/Plan.md');
    expect(relativePath('notes', 'specs/Plan.md')).toBe('../specs/Plan.md');
    expect(relativePath('notes/deep', 'notes/Plan.md')).toBe('../Plan.md');
    expect(relativePath('notes', 'notes/sub/Plan.md')).toBe('sub/Plan.md');
  });

  it('locates destinations in Markdown links, definitions and HTML attributes', () => {
    expect(markdownDestination('[a (b)](notes/Plan.md "Title")')).toMatchObject({ raw: 'notes/Plan.md', angle: false });
    expect(markdownDestination('![x](<My Plan.md>)')).toMatchObject({ raw: 'My Plan.md', angle: true });
    expect(markdownDestination('[x](a_(b).md)')).toMatchObject({ raw: 'a_(b).md' });
    expect(definitionDestination('[r]: <notes/Plan.md> "T"')).toMatchObject({ raw: 'notes/Plan.md', angle: true });
    expect(definitionDestination('[r]: ../Plan.md')).toMatchObject({ raw: '../Plan.md' });
    expect(attributeDestination("src='img/a.png'")).toMatchObject({ raw: 'img/a.png' });
  });

  it('applies non-overlapping edits only when the original text is still there', () => {
    expect(applyEdits('a [[x]] b [[y]]', [{ start: 2, end: 7, original: '[[x]]', text: '[[z]]' }, { start: 10, end: 15, original: '[[y]]', text: '[[w]]' }])).toBe('a [[z]] b [[w]]');
    expect(applyEdits('changed', [{ start: 0, end: 3, original: 'abc', text: 'x' }])).toBeUndefined();
  });
});

describe('planning link updates for moves', () => {
  it('renames wikilinks and embeds, keeping subpaths, display text and the basename style', async () => {
    const { texts, plan } = await rewritten({
      'Index.md': 'See [[Plan]], [[Plan#Goals]], ![[Plan#^b1]], [[Plan|the plan]], [[notes/Plan.md#^b1|x]] and [[Plan Old]].',
      'notes/Plan.md': '# Plan\n\n## Goals\n\nText ^b1\n',
      'Plan Old.md': 'Other',
    }, { 'notes/Plan.md': 'notes/Roadmap.md' });
    expect(texts['Index.md']).toBe('See [[Roadmap]], [[Roadmap#Goals]], ![[Roadmap#^b1]], [[Roadmap|the plan]], [[notes/Roadmap.md#^b1|x]] and [[Plan Old]].');
    expect(plan.references).toBe(5);
    expect(plan.unrewritten).toEqual([]);
  });

  it('leaves links that still resolve, unresolved links and aliases untouched', async () => {
    const { texts } = await rewritten({
      'Index.md': '---\naliases: [Home]\n---\n[[Plan]] [[Plan alias]] [[Missing]] [[Index]] [x](https://example.com/Plan.md)',
      'notes/Plan.md': '---\naliases: [Plan alias]\n---\n# Plan',
    }, { 'notes/Plan.md': 'archive/Plan.md' });
    expect(texts).toEqual({});
  });

  it('uses a full path when the new name is ambiguous and fixes links the move made ambiguous', async () => {
    const { texts } = await rewritten({
      'Index.md': '[[Plan]] and [[Other]]',
      'notes/Plan.md': 'Plan',
      'docs/Roadmap.md': 'Existing roadmap',
      'docs/Other.md': 'Other',
    }, { 'notes/Plan.md': 'specs/Roadmap.md' });
    expect(texts['Index.md']).toBe('[[specs/Roadmap]] and [[Other]]');
    const second = await rewritten({ 'Index.md': '[[Other]]', 'notes/Plan.md': 'Plan', 'docs/Other.md': 'Other' }, { 'notes/Plan.md': 'specs/Other.md' });
    expect(second.texts['Index.md']).toBe('[[docs/Other]]');
  });

  it('recomputes relative Markdown links, definitions and HTML, keeping fragments, titles and encoding', async () => {
    const { texts } = await rewritten({
      'notes/Index.md': '[a](Plan.md#Goals "T") [b](./Plan.md) ![c](<Plan.md>) [d](/notes/Plan.md) [e][r] <img src="Plan.md">\n\n[r]: Plan.md "Ref"\n',
      'notes/Plan.md': '# Plan\n\n## Goals\n',
    }, { 'notes/Plan.md': 'specs/My Plan.md' });
    expect(texts['notes/Index.md']).toBe('[a](../specs/My%20Plan.md#Goals "T") [b](../specs/My%20Plan.md) ![c](<../specs/My Plan.md>) [d](/specs/My%20Plan.md) [e][r] <img src="../specs/My%20Plan.md">\n\n[r]: ../specs/My%20Plan.md "Ref"\n');
  });

  it('keeps percent-encoding and a missing .md extension in Markdown links', async () => {
    const { texts } = await rewritten({ 'Index.md': '[a](notes/My%20Plan) [b](notes/My%20Plan.md)', 'notes/My Plan.md': 'Plan' }, { 'notes/My Plan.md': 'notes/Our Plan.md' });
    expect(texts['Index.md']).toBe('[a](notes/Our%20Plan) [b](notes/Our%20Plan.md)');
  });

  it('rewrites relative links inside the moved note and its folder', async () => {
    const { texts } = await rewritten({
      'notes/Plan.md': '[up](../Index.md) [side](Spec.md) [[Spec]]',
      'notes/Spec.md': 'Spec',
      'Index.md': 'Index',
    }, { 'notes/Plan.md': 'archive/2026/Plan.md' });
    expect(texts['notes/Plan.md']).toBe('[up](../../Index.md) [side](../../notes/Spec.md) [[Spec]]');
  });

  it('rewrites quoted frontmatter links including list values', async () => {
    const { texts } = await rewritten({
      'Index.md': '---\nrelated: "[[Plan]]"\nlist:\n  - "[[Plan#Goals|goals]]"\n  - "[x](notes/Plan.md)"\nother: "[[Else]]"\n---\nBody [[Plan]]\n',
      'notes/Plan.md': 'Plan', 'Else.md': 'Else',
    }, { 'notes/Plan.md': 'notes/Roadmap.md' });
    expect(texts['Index.md']).toBe('---\nrelated: "[[Roadmap]]"\nlist:\n  - "[[Roadmap#Goals|goals]]"\n  - "[x](notes/Roadmap.md)"\nother: "[[Else]]"\n---\nBody [[Roadmap]]\n');
  });

  it('rewrites Canvas file nodes and keeps their subpath and layout', async () => {
    const canvas = '{\n\t"nodes":[\n\t\t{"id":"n1","type":"file","file":"notes/Plan.md","subpath":"#Goals","x":0,"y":0,"width":1,"height":1},\n\t\t{"id":"n2","type":"file","file":"Other.md","x":0,"y":0,"width":1,"height":1}\n\t],\n\t"edges":[]\n}\n';
    const { texts } = await rewritten({ 'Board.canvas': canvas, 'notes/Plan.md': 'Plan', 'Other.md': 'Other' }, { 'notes/Plan.md': 'specs/Roadmap.md' });
    expect(texts['Board.canvas']).toBe(canvas.replace('"file":"notes/Plan.md"', '"file":"specs/Roadmap.md"'));
  });

  it('moves every file of a folder and updates only links that would stop resolving', async () => {
    const { texts } = await rewritten({
      'Index.md': '[[docs/a]] [b](docs/sub/b.md)',
      'docs/a.md': '[b](sub/b.md) [up](../Index.md)',
      'docs/sub/b.md': 'B',
      'Board.canvas': '{"nodes":[{"id":"a","type":"file","file":"docs/a.md","x":0,"y":0,"width":1,"height":1}]}',
    }, { 'docs/a.md': 'guides/docs/a.md', 'docs/sub/b.md': 'guides/docs/sub/b.md' });
    // `[[docs/a]]` still resolves by its path suffix, as in Obsidian, so it keeps its text; Canvas nodes need the exact path.
    expect(texts).toEqual({
      'Index.md': '[[docs/a]] [b](guides/docs/sub/b.md)', 'docs/a.md': '[b](sub/b.md) [up](../../Index.md)',
      'Board.canvas': '{"nodes":[{"id":"a","type":"file","file":"guides/docs/a.md","x":0,"y":0,"width":1,"height":1}]}',
    });
  });

  it('reports frontmatter links whose YAML spelling differs from the link text', async () => {
    const vault = { 'Index.md': '---\nrelated: "[[Plan \\u0041]]"\n---\n', 'notes/Plan A.md': 'Plan' };
    const files = new MemoryFiles(vault);
    const cache = await metadataIndex(files).load();
    const plan = planLinkUpdates(cache, new Map([['notes/Plan A.md', 'notes/Plan B.md']]));
    const result = rewriteText(plan.files[0]!, vault['Index.md'], cache.getFileCache('Index.md')!)!;
    expect(result.text).toBe(vault['Index.md']);
    expect(result.unrewritten).toEqual([{ source: 'Index.md', original: '[[Plan A]]', reason: expect.stringContaining('frontmatter') }]);
  });
});
