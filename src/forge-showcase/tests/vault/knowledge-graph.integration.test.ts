import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const skipped = new Set(['node_modules', 'dist', 'demo-dist', 'coverage']);

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || skipped.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [relative(root, path).split('\\').join('/')];
  });
}

const files = walk(root);
const notes = files.filter(path => path.endsWith('.md'));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Obsidian resolves a link by vault path or by unique file name; Markdown names may omit .md. */
function targets(link: string): string[] {
  const names = [link, link + '.md'];
  return files.filter(path => names.includes(path) || names.includes(basename(path)));
}

function wikilinks(text: string): string[] {
  const prose = text.replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, '').replace(/\x60[^\x60\n]*\x60/g, '');
  return [...prose.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(match => (match[1] ?? '').trim());
}

describe('Trailhead knowledge graph', () => {
  it('resolves every wikilink to exactly one vault file', () => {
    const broken = notes.flatMap(note => wikilinks(read(note))
      .filter(link => targets(link).length !== 1)
      .map(link => note + ' -> ' + link));
    expect(broken).toEqual([]);
  });

  it('links every workflow document back to the PRD', () => {
    const documents = notes.filter(path => path.startsWith('docs/') && /^stage: /m.test(read(path)) && !path.endsWith('Trailhead PRD.md'));
    expect(documents.length).toBeGreaterThanOrEqual(7);
    expect(documents.filter(path => !wikilinks(read(path)).includes('Trailhead PRD'))).toEqual([]);
  });

  it('keeps canvas file nodes and edges connected to existing files', () => {
    for (const canvas of files.filter(path => path.endsWith('.canvas'))) {
      const graph = JSON.parse(read(canvas)) as { nodes: { id: string; type: string; file?: string }[]; edges: { fromNode: string; toNode: string }[] };
      const ids = new Set(graph.nodes.map(node => node.id));
      expect(graph.nodes.filter(node => node.type === 'file' && !files.includes(node.file ?? '')).map(node => node.file)).toEqual([]);
      expect(graph.edges.filter(edge => !ids.has(edge.fromNode) || !ids.has(edge.toNode))).toEqual([]);
    }
  });
});
