import { Document, isMap, isScalar, parseDocument, type Pair, type Scalar } from 'yaml';

/** How Forge writes YAML it creates: block style, no folded lines, and `[a, b]` without padding inside flow brackets. */
export const yamlOutput = { lineWidth: 0, flowCollectionPadding: false } as const;

const json = (value: unknown) => JSON.stringify(value);
const lineStart = (text: string, offset: number) => text.lastIndexOf('\n', offset - 1) + 1;
/** The offset after the line break that ends the line containing `offset - 1`, or the text's end. */
function lineEnd(text: string, offset: number): number {
  if (offset > 0 && text[offset - 1] === '\n') return offset;
  const next = text.indexOf('\n', offset);
  return next < 0 ? text.length : next + 1;
}
/** A one-line YAML scalar for `value`, or undefined when YAML needs several lines or a collection for it. */
function inlineScalar(value: unknown): string | undefined {
  if (value !== null && typeof value === 'object') return undefined;
  const text = new Document(value).toString(yamlOutput).replace(/\n$/, '');
  return text.includes('\n') ? undefined : text;
}
const pairText = (key: string, value: unknown) => new Document({ [key]: value }).toString(yamlOutput);

interface Splice { start: number; end: number; text: string }

/**
 * The frontmatter YAML after setting `changes` and deleting `remove`, rewriting only the touched top-level entries:
 * a scalar value is replaced in place (its comment stays), another changed entry is rewritten as a whole, a
 * removed entry loses its lines, and a new entry is appended. Every other byte stays, so untouched values keep
 * their quoting, flow brackets, indentation and comments. Returns undefined when the YAML is not a top-level block
 * mapping; the caller then serializes the whole document instead. `newline` ends the lines it writes.
 */
export function editTopLevelEntries(yaml: string, changes: Readonly<Record<string, unknown>>, remove: readonly string[], newline: string): string | undefined {
  const document = parseDocument(yaml, { uniqueKeys: true });
  const contents = document.contents;
  if (contents !== null && (!isMap(contents) || contents.flow === true)) return undefined;
  const pairs = (contents?.items ?? []) as Pair<Scalar, unknown>[];
  const current = (document.toJS({ maxAliasCount: 100 }) ?? {}) as Record<string, unknown>;
  const find = (key: string) => pairs.find(pair => isScalar(pair.key) && pair.key.value === key);
  const splices: Splice[] = [];
  let appended = '';
  const span = (pair: Pair<Scalar, unknown>) => {
    const value = pair.value as { range?: [number, number, number] } | null;
    return { start: lineStart(yaml, pair.key.range![0]), end: lineEnd(yaml, value?.range?.[2] ?? pair.key.range![2]) };
  };
  for (const [key, value] of Object.entries(changes)) {
    const pair = find(key);
    if (pair === undefined) { appended += pairText(key, value); continue; }
    const node = pair.value;
    if (json(current[key]) === json(value)) continue;
    const scalar = isScalar(node) && (node.type === 'PLAIN' || node.type === 'QUOTE_DOUBLE' || node.type === 'QUOTE_SINGLE') ? inlineScalar(value) : undefined;
    if (scalar !== undefined && isScalar(node)) splices.push({ start: node.range![0], end: node.range![1], text: scalar });
    else splices.push({ ...span(pair), text: pairText(key, value) });
  }
  for (const key of remove) {
    const pair = find(key);
    if (pair !== undefined) splices.push({ ...span(pair), text: '' });
  }
  let result = yaml;
  for (const splice of splices.sort((a, b) => b.start - a.start)) result = result.slice(0, splice.start) + splice.text.replace(/\n/g, newline) + result.slice(splice.end);
  if (appended === '') return result;
  const separator = result === '' || result.endsWith('\n') ? '' : newline;
  return result + separator + appended.replace(/\n/g, newline);
}
