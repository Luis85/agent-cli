import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { Bases } from '../../src/the-forge/application/bases/query.ts';
import { NodeBasesQueryEngine } from '../../src/the-forge/infrastructure/bases/engine.ts';
import { NodeFiles } from '../../src/the-forge/infrastructure/workspace/files.ts';
import { ObsidianDocuments } from '../../src/the-forge/infrastructure/documents/codec.ts';

let root: string, bases: Bases;
async function put(path: string, source: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), source);
}
async function query(filters: unknown, extra: Record<string, unknown> = {}, context?: string) {
  await put('Views/Review.base', stringify({ filters, views: [{ type: 'table', name: 'Review' }], ...extra }));
  return bases.query('Views/Review.base', context === undefined ? {} : { context });
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-bases-conformance-'));
  bases = new Bases(new NodeBasesQueryEngine(await NodeFiles.at(root), new ObsidianDocuments()));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

// Acceptance is grounded in help.obsidian.md/bases/syntax and /tags, plus the
// pinned evaluator's published docs/compatibility.md link-resolution oracle.
describe('independent native Bases conformance', () => {
  it('keeps default Base context separate from an embedding note and row properties', async () => {
    await put('Views/Neighbor.md', '---\nstatus: review\n---\n');
    await put('Projects/Dashboard.md', '---\nstatus: approved\nthreshold: 5\n---\n');
    await put('Projects/Ready.md', '---\nstatus: approved\npoints: 8\n---\n');
    expect((await query('file.ext == "md" && file.folder == this.file.folder')).files).toEqual(['Views/Neighbor.md']);
    const result = await query('file.ext == "md" && formula["is ready"]', {
      formulas: { 'score above': 'points > this["threshold"]', 'is ready': 'formula["score above"] && status == this.status' },
    }, 'Projects/Dashboard.md');
    expect(result.files).toEqual(['Projects/Ready.md']);
    expect(result.context).toBe('Projects/Dashboard.md');
  });

  it('resolves frontmatter links by file identity while keeping Markdown property links as strings', async () => {
    await put('Projects/Target.md', '# Target\n');
    await put('Notes/Source.md', '---\nowner: "[[projects/target#Heading|Owner]]"\nowners: ["[[Projects/Target.md|First]]", "[[Projects/Target#Other|Second]]"]\nweb: "[owner](../Projects/Target.md)"\n---\n');
    const result = await query('file.path == "Notes/Source.md" && owner == this && owners.contains(this) && owners.filter(value == this).length == 2 && web.isType("string") && file.hasLink(this.file)', {}, 'Projects/Target.md');
    expect(result.files).toEqual(['Notes/Source.md']);
  });

  it('indexes relative reference links, percent spaces, embeds and deduplicated source backlinks', async () => {
    await put('Assets/Space Name.md', '# Target');
    await put('Assets/picture.png', 'image bytes');
    await put('Notes/Source.md', '[Target][ref]\n\n[ref]: ../Assets/Space%20Name.md#Heading\n\n![[Assets/picture.png|200]]\n[[Assets/Space Name#Other]]\n![remote](https://example.com/image.png)\n');
    expect((await query('file.path == "Notes/Source.md" && file.links.length == 3 && file.embeds.length == 1 && file.hasLink("Assets/Space Name.md")')).files).toEqual(['Notes/Source.md']);
    expect((await query('file.backlinks.length == 1 && file.backlinks[0].asFile().path == "Notes/Source.md"')).files).toEqual(['Assets/Space Name.md', 'Assets/picture.png']);
  });

  it('retains the oracle distinction between unresolved wiki and Markdown target spelling', async () => {
    await put('Wiki.md', '[[Missing Note]]');
    await put('Markdown.md', '[missing](Missing%20Note.md)');
    expect((await query('file.path == "Wiki.md" && file.hasLink("Missing Note") && !file.hasLink("Missing Note.md")')).files).toEqual(['Wiki.md']);
    expect((await query('file.hasLink("Missing Note.md")')).files).toEqual(['Markdown.md']);
  });

  it('honors documented Unicode and nested case-insensitive tags', async () => {
    await put('Tags.md', '---\ntags: [Project/Review]\n---\n#🎯 #café #1984 #y1984\n');
    expect((await query('file.hasTag("project") && file.hasTag("CAFÉ") && file.hasTag("🎯") && file.hasTag("y1984") && !file.hasTag("1984")')).files).toEqual(['Tags.md']);
  });

  it('does not turn escaped syntax, comments or code examples into tags and links', async () => {
    await put('Literal.md', '\\#literal \\[\\[Missing\\]\\]\n\n%% #comment [[Comment]] %%\n\n`#code [[Code]]`\n\n```md\n#fence [[Fence]]\n```\n');
    expect((await query('file.path == "Literal.md" && file.tags.length == 0 && file.links.length == 0')).files).toEqual(['Literal.md']);
  });

  it('uses configured date types in embedding context and numeric formula sort before limits', async () => {
    await put('.obsidian/types.json', JSON.stringify({ types: { due: 'date', deadline: 'date' } }));
    await put('Dashboard.md', '---\ndeadline: 2026-10-10\n---\n');
    await put('Slow.md', '---\ndue: 2026-10-09\npoints: 2\n---\n');
    await put('Fast.md', '---\ndue: 2026-10-08\npoints: 10\n---\n');
    await put('Late.md', '---\ndue: 2026-10-11\npoints: 100\n---\n');
    const result = await query('file.ext == "md" && due && due < this.deadline', {
      formulas: { score: 'points * 2' },
      views: [{ type: 'table', name: 'Review', sort: [{ property: 'formula.score', direction: 'DESC' }], limit: 1 }],
    }, 'Dashboard.md');
    expect(result).toMatchObject({ files: ['Fast.md'], total: 2 });
  });

  it('keeps zero-valued group membership distinct from absent properties before applying limits', async () => {
    await put('A.md', '---\nphase: 0\npoints: 2\n---\n');
    await put('B.md', '---\nphase: 0\npoints: 10\n---\n');
    await put('C.md', '---\nphase: 2\npoints: 100\n---\n');
    await put('D.md', '---\npoints: 20\n---\n');
    const result = await query('file.ext == "md"', {
      views: [{ type: 'table', name: 'Review', groupBy: { property: 'phase', direction: 'DESC' },
        groupOrder: [0, null], sort: [{ property: 'points', direction: 'DESC' }], limit: 2 }],
    });
    expect(result).toMatchObject({ files: ['B.md', 'A.md'], total: 3 });
  });
});
