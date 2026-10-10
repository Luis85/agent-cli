import { parseLinktext, type CachedMetadata, type LinkSyntax } from '../../domain/metadata/cache.ts';
import { linkIndex, resolveLinkpath, type LinkIndex } from '../../domain/metadata/link-resolution.ts';
import {
  applyEdits, attributeDestination, definitionDestination, markdownDestination, rewriteDestination, rewriteWikilink, vaultLinkpath, type Destination, type TextEdit,
} from '../../domain/metadata/link-text.ts';
import type { MetadataCache } from '../metadata/ports.ts';

/** A reference the planner could not rewrite safely, such as a frontmatter value whose YAML spelling differs from its link text. */
export interface UnrewrittenLink { source: string; original: string; reason: string }
/** One file's planned link updates: body edits by offset, frontmatter text replacements, and Canvas file node values by node id. */
export interface FileLinkPlan {
  source: string;
  edits: TextEdit[];
  frontmatter: Array<{ original: string; text: string }>;
  canvas: Array<{ node: string; original: string; file: string }>;
}
export interface LinkPlan { files: FileLinkPlan[]; references: number; unrewritten: UnrewrittenLink[] }

interface Candidate { link: string; original: string; syntax: LinkSyntax; relative: boolean; apply: (text: string) => void }

const sorted = (paths: Iterable<string>) => [...paths].sort();
const isRelativeSyntax = (syntax: LinkSyntax) => !['wikilink', 'canvas'].includes(syntax);

function indexOf(paths: readonly string[], cache: MetadataCache, rename: (path: string) => string): LinkIndex {
  const aliases = new Map<string, readonly string[]>();
  for (const path of cache.files()) {
    const names = cache.getFileCache(path)?.aliases;
    if (names?.length) aliases.set(rename(path), names);
  }
  return linkIndex(paths, aliases);
}

/**
 * Plans every link update that a set of path moves needs. A resolved reference is rewritten when, after the move,
 * its unchanged text would no longer resolve to the same (moved) file: a renamed target, a relative path from a
 * moved source, or a bare name the move made ambiguous. Canvas file nodes, which Obsidian opens by exact path,
 * follow every move of their file. References that still resolve, unresolved references,
 * aliases and external URLs stay untouched. Paths are relative to the cache root; `moves` maps old to new paths.
 */
export function planLinkUpdates(cache: MetadataCache, moves: ReadonlyMap<string, string>): LinkPlan {
  const rename = (path: string) => moves.get(path) ?? path;
  const before = indexOf(cache.files(), cache, path => path);
  const after = indexOf(sorted(cache.files().map(rename)), cache, rename);
  const files: FileLinkPlan[] = [], unrewritten: UnrewrittenLink[] = [];
  let references = 0;
  for (const source of cache.files()) {
    const metadata = cache.getFileCache(source);
    if (!metadata) continue;
    const plan: FileLinkPlan = { source, edits: [], frontmatter: [], canvas: [] };
    const newSource = rename(source);
    for (const candidate of candidates(metadata, plan)) {
      const previous = resolveLinkpath(before, candidate.link, source, { relative: candidate.relative, aliases: true });
      if (previous.status !== 'resolved') continue;
      const target = rename(previous.path);
      // Obsidian opens a Canvas file node by its exact path, so a node follows every move of its file.
      if (candidate.syntax === 'canvas' ? !moves.has(previous.path) : resolvesTo(after, candidate, newSource, target)) continue;
      const text = replacement(candidate, after, source, previous.path, newSource, target);
      if (text === undefined) { unrewritten.push({ source, original: candidate.original, reason: 'Unrecognized link syntax.' }); continue; }
      candidate.apply(text);
      references++;
    }
    if (plan.edits.length + plan.frontmatter.length + plan.canvas.length > 0) files.push(plan);
  }
  return { files, references, unrewritten };
}

function resolvesTo(index: LinkIndex, candidate: Candidate, source: string, target: string): boolean {
  const current = resolveLinkpath(index, candidate.link, source, { relative: candidate.relative, aliases: true });
  return current.status === 'resolved' && current.path === target;
}

function candidates(metadata: CachedMetadata, plan: FileLinkPlan): Candidate[] {
  const result: Candidate[] = [];
  for (const item of [...metadata.links ?? [], ...metadata.embeds ?? []]) {
    // Reference-style uses carry no path; their definition is rewritten instead.
    if (item.syntax === 'reference') continue;
    const { start, end } = { start: item.position.start.offset, end: item.position.end.offset };
    result.push({ link: item.link, original: item.original, syntax: item.syntax, relative: isRelativeSyntax(item.syntax), apply: text => plan.edits.push({ start, end, original: item.original, text }) });
  }
  for (const item of metadata.referenceLinks ?? []) {
    const { start, end } = { start: item.position.start.offset, end: item.position.end.offset };
    result.push({ link: item.link, original: item.original, syntax: 'reference', relative: true, apply: text => plan.edits.push({ start, end, original: item.original, text }) });
  }
  for (const item of metadata.frontmatterLinks ?? []) {
    result.push({ link: item.link, original: item.original, syntax: item.syntax, relative: isRelativeSyntax(item.syntax), apply: text => {
      if (!plan.frontmatter.some(entry => entry.original === item.original)) plan.frontmatter.push({ original: item.original, text });
    } });
  }
  for (const item of metadata.canvasLinks ?? []) {
    result.push({ link: item.link, original: item.original, syntax: 'canvas', relative: false, apply: file => plan.canvas.push({ node: item.node, original: item.original, file }) });
  }
  return result;
}

/** The candidate's new source text; for Canvas nodes the new `file` value. Undefined when its syntax is not recognized. */
function replacement(candidate: Candidate, index: LinkIndex, oldSource: string, oldTarget: string, newSource: string, target: string): string | undefined {
  const { original, syntax, link } = candidate;
  if (syntax === 'canvas') return target;
  if (syntax === 'wikilink') return rewriteWikilink(original, link, vaultLinkpath(index, parseLinktext(link).path, target, newSource));
  const destination: Destination | undefined = syntax === 'markdown' ? markdownDestination(original) : syntax === 'reference' ? definitionDestination(original) : attributeDestination(original);
  if (!destination) return undefined;
  return original.slice(0, destination.start) + rewriteDestination(destination, oldSource, oldTarget, newSource, target) + original.slice(destination.end);
}

/**
 * Applies one file's planned updates to its decoded text (BOM included, as cache offsets count it). Body edits
 * replace exact offsets; frontmatter links are replaced literally inside the frontmatter block; Canvas file nodes
 * are replaced in their JSON string values, falling back to re-serializing the Canvas. Returns undefined when the
 * text no longer matches the cache, and lists frontmatter links whose YAML spelling was not found.
 */
export function rewriteText(plan: FileLinkPlan, text: string, metadata: CachedMetadata): { text: string; unrewritten: UnrewrittenLink[] } | undefined {
  const unrewritten: UnrewrittenLink[] = [];
  if (plan.canvas.length > 0) return { text: rewriteCanvas(text, plan.canvas), unrewritten };
  let result = applyEdits(text, plan.edits);
  if (result === undefined) return undefined;
  const block = metadata.frontmatterPosition;
  if (block && plan.frontmatter.length > 0) {
    let yaml = result.slice(block.start.offset, block.end.offset);
    for (const { original, text: replacement } of plan.frontmatter) {
      if (yaml.includes(original)) yaml = yaml.split(original).join(replacement);
      else unrewritten.push({ source: plan.source, original, reason: 'The frontmatter spells this link differently, for example with YAML escapes; edit it with properties.' });
    }
    result = result.slice(0, block.start.offset) + yaml + result.slice(block.end.offset);
  }
  return { text: result, unrewritten };
}

/** Rewrites Canvas `file` values in place, keeping the JSON layout; re-serializes only if the text form was not found. */
function rewriteCanvas(text: string, nodes: FileLinkPlan['canvas']): string {
  const files = new Map(nodes.map(node => [node.original, node.file]));
  const replaced = text.replace(/("file"\s*:\s*)"((?:[^"\\]|\\.)*)"/g, (match, key: string, value: string) => {
    const file = files.get(JSON.parse(`"${value}"`) as string);
    return file === undefined ? match : `${key}${JSON.stringify(file)}`;
  });
  const data = JSON.parse(replaced.replace(/^﻿/, '')) as { nodes?: Array<{ id?: unknown; file?: unknown }> };
  const expected = new Map(nodes.map(node => [node.node, node.file]));
  const nodesOf = data.nodes ?? [];
  if (nodesOf.every(node => !expected.has(String(node.id)) || node.file === expected.get(String(node.id)))) return replaced;
  for (const node of nodesOf) if (expected.has(String(node.id))) node.file = expected.get(String(node.id));
  return (text.startsWith('﻿') ? '﻿' : '') + JSON.stringify(data, null, 2) + '\n';
}
