import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { Bases } from '../../src/plugins/bases/application/query.ts';
import { basesEngine } from '../support/metadata.ts';

let root: string, bases: Bases;
const put = async (path: string, content: string | Uint8Array) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
};
const definition = async (data: Record<string, unknown>, path = 'tasks.base') => {
  await put(path, stringify({ views: [{ type: 'table', name: 'All' }], ...data }));
  return path;
};
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-bases-'));
  bases = new Bases(await basesEngine(root));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('native Bases repository queries without Obsidian', () => {
  it('combines global/view filters, dependent formulas, typed sort and both limits without mutations', async () => {
    await put('notes/first.md', '---\nstatus: open\npoints: 3\n---\n# First');
    await put('notes/second.md', '---\nstatus: open\npoints: 8\n---\n# Second');
    await put('notes/done.md', '---\nstatus: done\npoints: 20\n---\n');
    const path = await definition({ filters: 'file.ext == "md"', formulas: { doubled: 'points * 2', score: 'formula.doubled + 1' }, views: [
      { type: 'table', name: 'Open', filters: { and: ['status == "open"', 'formula.score > 5'] }, sort: [{ property: 'formula.score', direction: 'DESC' }], limit: 2 },
      { type: 'list', name: 'Done', filters: 'status == "done"' },
    ] });
    const before = await readFile(join(root, path));
    expect(await bases.query(path, { limit: 1 })).toMatchObject({ path, view: 'Open', context: path, files: ['notes/second.md'], total: 2 });
    expect((await bases.query(path, { view: 'Done' })).files).toEqual(['notes/done.md']);
    expect((await bases.query(path, { limit: 0 })).files).toEqual([]);
    expect(await readFile(join(root, path))).toEqual(before);
  });

  it('indexes frontmatter/inline nested tags and wikilinks, embeds, markdown links, backlinks and this context', async () => {
    await put('Projects/Target.md', '---\nstatus: open\n---\n');
    await put('Notes/Source.md', '---\ntags: [work/project]\nowner: "[[Projects/Target]]"\nowners: ["[[Projects/Target]]"]\n---\n#inline/tag\n[[Projects/Target]] ![[assets/image.png]] [target](../Projects/Target.md)\n`#ignored [[Missing]]`\n```md\n#ignored [[Missing]]\n```');
    await put('assets/image.png', new Uint8Array([1, 2, 3]));
    const path = await definition({ filters: 'file.ext == "md"', views: [{ type: 'table', name: 'Linked', filters: 'file.hasTag("work") && file.hasTag("inline") && !file.hasTag("ignored") && file.hasLink(this.file) && owner == this && owners.contains(this) && this.status == "open" && file.embeds.length == 1' }] });
    expect((await bases.query(path, { context: 'Projects/Target.md' })).files).toEqual(['Notes/Source.md']);
    await definition({ filters: 'file.backlinks.length == 1 && file.backlinks[0].asFile().path == "Notes/Source.md"' });
    expect((await bases.query(path)).files).toEqual(['Projects/Target.md', 'assets/image.png']);
  });

  it('uses Obsidian property types, dates, lists, regex functions and filesystem metadata', async () => {
    await put('.obsidian/types.json', JSON.stringify({ types: { due: 'date', labels: 'multitext' } }));
    await put('Task.md', '---\ndue: 2026-10-07\nlabels: [alpha, beta]\n---\n');
    const path = await definition({ filters: 'file.ext == "md" && due.year == 2026 && labels.filter(value.contains("a")).length == 2 && /Task/.matches(file.name) && file.size > 0 && file.mtime <= now()' });
    expect((await bases.query(path)).files).toEqual(['Task.md']);
  });

  it('applies native group visibility and group order before row limits', async () => {
    await put('A.md', '---\nstatus: Planned\n---\n');
    await put('B.md', '---\nstatus: Done\n---\n');
    await put('C.md', '---\nstatus: Hidden\n---\n');
    await put('D.md', '# No status');
    const path = await definition({ filters: 'file.ext == "md"', views: [{ type: 'table', name: 'Board', groupBy: { property: 'note.status', direction: 'ASC' }, groupOrder: ['Done', null, 'Planned'], limit: 2 }] });
    expect(await bases.query(path)).toMatchObject({ total: 3, files: ['B.md', 'D.md'] });
    await definition({ views: [{ type: 'table', name: 'Empty', groupBy: { property: 'file.ext', direction: 'ASC' }, groupOrder: [] }] });
    expect((await bases.query(path)).files).toEqual([]);
  });

  it('includes attachment metadata and excludes dot paths, symlinks and code-only links/tags', async () => {
    await put('Visible.md', '# note');
    await put('asset.pdf', new Uint8Array([1, 2, 3]));
    await put('.claude/agents/hidden.md', '---\ninvalid: [\n');
    await put('.hidden.md', '# hidden');
    await symlink('/etc/passwd', join(root, 'outside.md'));
    const path = await definition({});
    expect((await bases.query(path)).files).toEqual(['Visible.md', 'asset.pdf', 'tasks.base']);
    await expect(bases.query('../outside.base')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(bases.query(path, { context: 'outside.md' })).rejects.toMatchObject({ code: 'BASE_CONTEXT_NOT_FOUND' });
  });

  it('treats a native not list as none of its conditions and supports nested boolean trees', async () => {
    await put('A.md', '---\na: true\nb: false\n---\n');
    await put('B.md', '---\na: false\nb: false\n---\n');
    const path = await definition({ filters: { and: ['file.ext == "md"', { not: ['a', 'b'] }] } });
    expect((await bases.query(path)).files).toEqual(['B.md']);
  });

  it.each(['file.unknownFunction()', '"x".unknownMethod()', 'formula.broken'])('reports runtime errors instead of dropping affected files: %s', async expression => {
    await put('Note.md', '# Note');
    const path = await definition({ formulas: { broken: '"x".unknownMethod()' }, filters: { and: ['file.ext == "md"', expression] } });
    await expect(bases.query(path)).rejects.toMatchObject({ code: 'BASE_EVALUATION_ERROR' });
  });

  it.each(['{"a":1}', '+points', 'x ==', 'formula.a'])('rejects invalid expressions or circular formulas before returning files: %s', async expression => {
    const path = await definition({ formulas: { a: expression }, filters: 'false' });
    await expect(bases.query(path)).rejects.toMatchObject({ code: 'INVALID_BASE_EXPRESSION' });
  });

  it('reports missing views, invalid metadata and ambiguous links with named errors', async () => {
    const path = await definition({});
    await expect(bases.query(path, { view: 'Missing' })).rejects.toMatchObject({ code: 'BASE_VIEW_NOT_FOUND' });
    await expect(bases.query(path, { limit: -1 })).rejects.toMatchObject({ code: 'INVALID_BASE_QUERY' });
    await put('bad.md', '---\nx: [\n---');
    await expect(bases.query(path)).rejects.toMatchObject({ code: 'BASE_INDEX_ERROR' });
    await rm(join(root, 'bad.md'));
    await put('A/Target.md', ''); await put('B/Target.md', ''); await put('Link.md', '[[Target]]');
    await expect(bases.query(path)).rejects.toMatchObject({ code: 'AMBIGUOUS_BASE_LINK' });
  });

  it('publishes the pinned evaluator and its oracle limitations', () => {
    expect(bases.capabilities()).toMatchObject({ engine: 'obsidian-bases-expression', version: '0.2.0', standalone: true, expressions: { oracle: { caseCount: 281, repeatedAcrossObsidianVersions: false } } });
  });

  it('evaluates dynamic formula names with native missing-property behavior and detects runtime cycles', async () => {
    await put('Note.md', '---\nselect: score\npoints: 7\n---\n');
    const path = await definition({ formulas: { score: 'points * 2', chosen: 'formula[select]' }, filters: 'file.ext == "md" && formula.chosen == 14 && formula["constructor" + ""] == null' });
    expect((await bases.query(path)).files).toEqual(['Note.md']);
    await definition({ formulas: { score: 'formula[select]' }, filters: 'file.ext == "md" && formula.score' });
    await expect(bases.query(path)).rejects.toMatchObject({ code: 'BASE_EVALUATION_ERROR' });
  });

  it('indexes standard HTML links and embeds without executing scripts or following external URLs', async () => {
    await put('Target.md', '# Target');
    await put('image.png', new Uint8Array([1]));
    await put('Source.md', '<div>\n<a href="Target.md">target</a><img src="image.png"><a href="https://example.com">external</a>\n<script>throw new Error("Never executed")</script>\n</div>');
    const path = await definition({ filters: 'file.path == "Source.md" && file.links.length == 2 && file.embeds.length == 1 && file.hasLink("Target.md")' });
    expect((await bases.query(path)).files).toEqual(['Source.md']);
  });

  it('rejects direct numeric method syntax while accepting the native parenthesized form', async () => {
    const path = await definition({ filters: '(1).isTruthy()' });
    expect((await bases.query(path)).files).toEqual(['tasks.base']);
    await definition({ filters: '1.isTruthy()' });
    await expect(bases.query(path)).rejects.toMatchObject({ code: 'INVALID_BASE_EXPRESSION' });
  });

  it('keeps missing and null typed date properties empty in row and embedding context', async () => {
    await put('.obsidian/types.json', JSON.stringify({ types: { due: 'date', deadline: 'datetime' } }));
    await put('Missing.md', '# No date');
    await put('Null.md', '---\ndue: null\ndeadline: null\n---\n');
    const path = await definition({ filters: 'file.ext == "md" && due.isEmpty() && this.deadline.isEmpty()' });
    expect((await bases.query(path, { context: 'Null.md' })).files).toEqual(['Missing.md', 'Null.md']);
  });
});
