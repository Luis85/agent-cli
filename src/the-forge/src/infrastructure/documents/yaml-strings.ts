import { isAlias, isMap, isScalar, isSeq, parseDocument, type Document, type Scalar } from 'yaml';
import type { YamlStringReplacement } from '../../application/workspace/ports.ts';

type Pair = readonly [from: string, to: string];
interface Target { path: Array<string | number>; node: Scalar<string>; replacements: number[] }

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const json = (document: Document) => JSON.stringify(document.toJS({ maxAliasCount: 100 }));

/**
 * Replaces every occurrence of each pair's `from` in one left-to-right pass, longest first, so a replacement's
 * output is never matched again. `used` lists the pairs that matched.
 */
function replaceOnce(value: string, pairs: readonly Pair[]): { text: string; used: Set<number> } {
  const used = new Set<number>();
  const order = pairs.map((_, index) => index).filter(index => pairs[index]![0].length > 0).sort((a, b) => pairs[b]![0].length - pairs[a]![0].length);
  if (order.length === 0) return { text: value, used };
  const lookup = new Map<string, number>();
  for (const index of order) if (!lookup.has(pairs[index]![0])) lookup.set(pairs[index]![0], index);
  const pattern = new RegExp(order.map(index => escapeRegExp(pairs[index]![0])).join('|'), 'g');
  const text = value.replace(pattern, match => {
    const index = lookup.get(match)!;
    used.add(index);
    return pairs[index]![1];
  });
  return { text, used };
}

/**
 * The string scalars of a document by node, each with its path and every dotted key that reaches it, as the
 * metadata cache names frontmatter links: an anchored scalar is also reached through the keys of its aliases.
 */
function stringScalars(document: Document): Map<Scalar<string>, { path: Array<string | number>; keys: string[] }> {
  const found = new Map<Scalar<string>, { path: Array<string | number>; keys: string[] }>();
  const walk = (node: unknown, key: string, path: Array<string | number>) => {
    if (isMap(node)) {
      for (const pair of node.items) {
        const name = String(isScalar(pair.key) ? pair.key.value : pair.key);
        walk(pair.value, key ? `${key}.${name}` : name, [...path, name]);
      }
    } else if (isSeq(node)) node.items.forEach((item, index) => walk(item, key ? `${key}.${index}` : String(index), [...path, index]));
    else if (isAlias(node)) {
      // Anchors precede their aliases, so the anchored scalar is already known.
      const anchored = node.resolve(document);
      if (isScalar(anchored)) found.get(anchored as Scalar<string>)?.keys.push(key);
    } else if (isScalar(node) && typeof node.value === 'string' && node.range) found.set(node as Scalar<string>, { path, keys: [key] });
  };
  walk(document.contents, '', []);
  return found;
}

/**
 * Source texts that may spell a scalar's new value, most faithful first: the replacements applied to its source
 * text with the escapes of its quoting style (keeping every other escape and line break), the value re-serialized
 * in its own single-quoted style, and finally a double-quoted scalar, which can hold any value on one line.
 */
function candidates(node: Scalar<string>, source: string, value: string, pairs: readonly Pair[]): string[] {
  const encode = node.type === 'QUOTE_SINGLE' ? (text: string) => text.replaceAll("'", "''")
    : node.type === 'QUOTE_DOUBLE' ? (text: string) => text.replace(/[\\"]/g, '\\$&') : (text: string) => text;
  const raw = replaceOnce(source, pairs.map(([from, to]) => [encode(from), encode(to)] as const)).text;
  const trailing = /(?:\r\n|\n|\r)*$/.exec(source)![0];
  return [
    raw,
    ...(node.type === 'QUOTE_SINGLE' && !/[\r\n]/.test(value) ? [`'${encode(value)}'`] : []),
    JSON.stringify(value) + (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED' ? trailing : ''),
  ];
}

/**
 * Applies frontmatter link replacements to YAML text by located scalar offsets, in one pass per scalar. Each
 * replacement only touches the string value at its key, or the anchored value an alias at its key names. A changed
 * scalar keeps its quoting style when the new value fits it; otherwise it becomes double-quoted. A spliced candidate
 * is accepted only when the whole document then parses to exactly the expected values, so no candidate can change
 * another value or the YAML structure. Bytes outside rewritten scalars never change. `applied` lists the
 * replacements made.
 */
export function replaceInYamlStrings(yaml: string, document: Document, replacements: readonly YamlStringReplacement[]): { yaml: string; applied: number[] } {
  const targets: Target[] = [];
  for (const [node, { path, keys }] of stringScalars(document)) {
    const indexes = replacements.flatMap((replacement, index) => (keys.includes(replacement.key) ? [index] : []));
    if (indexes.length) targets.push({ path, node, replacements: indexes });
  }
  const expected = document.clone();
  const applied: number[] = [];
  let text = yaml;
  // From the end, so the offsets of scalars still to rewrite stay valid.
  for (const target of targets.sort((a, b) => b.node.range![0] - a.node.range![0])) {
    const pairs = target.replacements.map(index => [replacements[index]!.original, replacements[index]!.text] as const);
    const { text: value, used } = replaceOnce(target.node.value, pairs);
    if (used.size === 0) continue;
    const [start, end] = target.node.range!;
    const node = expected.getIn(target.path, true) as Scalar<string>;
    const previous = node.value;
    node.value = value;
    const wanted = json(expected);
    const accepted = candidates(target.node, text.slice(start, end), value, pairs).find(candidate => {
      const spliced = parseDocument(text.slice(0, start) + candidate + text.slice(end), { uniqueKeys: true });
      try { return spliced.errors.length === 0 && json(spliced) === wanted; }
      catch { return false; /* A candidate that YAML cannot resolve is not a faithful spelling. */ }
    });
    if (accepted === undefined) { node.value = previous; continue; }
    text = text.slice(0, start) + accepted + text.slice(end);
    const matched = new Set([...used].map(index => pairs[index]![0]));
    applied.push(...target.replacements.filter(index => matched.has(replacements[index]!.original)));
  }
  return { yaml: text, applied: applied.sort((a, b) => a - b) };
}
