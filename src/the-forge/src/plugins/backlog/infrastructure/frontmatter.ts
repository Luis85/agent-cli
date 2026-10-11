import { isAlias, isMap, isScalar, parseDocument, stringify, visit, type Document } from 'yaml';

/**
 * Edits a note's frontmatter the way backlog-view's `processFrontMatter` callbacks change it (changed keys set in
 * place, removed keys deleted, new keys appended) while keeping every other byte: each changed top-level entry is
 * rewritten as Obsidian's `stringifyYaml` writes it (`"[[Note]]"`, `""`, block lists), and untouched entries,
 * comments, folding and the body stay as they are. A note without frontmatter gains a block; a flow-style block, or
 * one with anchors or aliases, is rewritten whole, with every alias resolved to its value as Obsidian's own whole
 * rewrite does. `frontmatter` is the complete new property set.
 */
/** Whether nodes are shared through anchors and aliases, which a rewrite of single entries could break apart. */
function sharesNodes(document: Document): boolean {
  let shared = false;
  visit(document, (_key, node) => {
    if (isAlias(node) || (node !== null && typeof node === 'object' && 'anchor' in node && node.anchor)) { shared = true; return visit.BREAK; }
    return undefined;
  });
  return shared;
}

export function editFrontmatter(text: string, frontmatter: Record<string, unknown>, changes: Record<string, unknown>, removed: readonly string[]): string {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const source = text.slice(bom.length);
  const newline = /\r\n/.test(source) ? '\r\n' : '\n';
  const lines = (yaml: string) => yaml.replace(/\r?\n/g, newline);
  const opening = /^---[ \t]*\r?\n/.exec(source);
  const closing = opening ? /^---[ \t]*(\r?\n|$)/m.exec(source.slice(opening[0].length)) : null;
  if (!opening || !closing) return `${bom}---${newline}${lines(stringify(frontmatter))}---${newline}${source}`;
  const start = opening[0].length, end = start + closing.index;
  const yaml = source.slice(start, end);
  const document = parseDocument(yaml);
  const whole = () => `${bom}---${newline}${lines(Object.keys(frontmatter).length > 0 ? stringify(frontmatter) : '')}${source.slice(end)}`;
  if (document.errors.length > 0 || (document.contents !== null && (!isMap(document.contents) || document.contents.flow)) || sharesNodes(document)) return whole();
  const spans = new Map<string, [number, number]>();
  for (const pair of isMap(document.contents) ? document.contents.items : []) {
    if (!isScalar(pair.key) || !pair.key.range) return whole();
    const from = pair.key.range[0];
    let to = (pair.value as { range?: [number, number, number] } | null)?.range?.[2] ?? pair.key.range[2];
    if (to > 0 && yaml[to - 1] !== '\n') { const next = yaml.indexOf('\n', to); to = next < 0 ? yaml.length : next + 1; }
    spans.set(String(pair.key.value), [from, to]);
  }
  const edits: Array<{ from: number; to: number; text: string }> = [];
  const appended: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    const entry = lines(stringify({ [key]: value }));
    const span = spans.get(key);
    if (span) edits.push({ from: span[0], to: span[1], text: entry }); else appended.push(entry);
  }
  for (const key of removed) { const span = spans.get(key); if (span) edits.push({ from: span[0], to: span[1], text: '' }); }
  let result = yaml;
  for (const edit of edits.sort((a, b) => b.from - a.from)) result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
  if (appended.length > 0 && result.length > 0 && !result.endsWith('\n')) result += newline;
  return `${bom}${source.slice(0, start)}${result}${appended.join('')}${source.slice(end)}`;
}
