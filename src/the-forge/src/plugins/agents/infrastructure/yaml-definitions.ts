import { isMap, isScalar, isSeq, LineCounter, parseDocument, stringify, type Document, type Node } from 'yaml';
import { ensure, forgeError } from '../../../domain/shared/errors.ts';
import { diagnostic, isObject, pointerSegments, type AgentConfigDocument } from '../domain/config.ts';
import type { DefinitionCodec, ParsedDefinition } from '../application/ports.ts';

const parseOptions = { merge: true, uniqueKeys: true, prettyErrors: true } as const;
/** Alias expansions allowed per document; more fail the file with a diagnostic instead of exhausting memory. */
const maxAliasCount = 1000;
const header = '# docker-agent configuration (https://github.com/docker/docker-agent), managed with The Forge.\n';

/** The node a pointer names, or its nearest existing ancestor (a missing required property points at its parent). */
function locateNode(document: Document, path: string): Node | undefined {
  let node = document.contents as Node | null | undefined;
  for (const segment of pointerSegments(path)) {
    let next: Node | null | undefined;
    if (isSeq(node)) next = node.items[Number(segment)] as Node | undefined;
    else if (isMap(node)) {
      const pair = node.items.find(item => isScalar(item.key) && String(item.key.value) === segment);
      next = pair ? (pair.value as Node | null) ?? (pair.key as Node) : undefined;
    }
    if (!next) break;
    node = next;
  }
  return node ?? undefined;
}

/** Indentation of the file: the first indented line's width, and whether `- ` items sit deeper than their key. */
function layout(text: string): { indent: number; indentSeq: boolean } {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '' && !line.trimStart().startsWith('#'));
  const indented = lines.find(line => /^ +\S/.test(line));
  const indent = indented ? indented.length - indented.trimStart().length : 2;
  const index = lines.findIndex((line, position) => /:\s*$/.test(line) && /^\s*- /.test(lines[position + 1] ?? ''));
  const width = (line: string) => line.length - line.trimStart().length;
  return { indent: Math.min(Math.max(indent, 2), 8), indentSeq: index < 0 ? true : width(lines[index + 1]!) > width(lines[index]!) };
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** The document's value within the alias limit; a file over it cannot be edited. */
function expanded(document: Document): AgentConfigDocument {
  try { return document.toJS({ maxAliasCount }) as AgentConfigDocument; }
  catch (error) { throw forgeError('INVALID_YAML', `The YAML cannot be expanded: ${error instanceof Error ? error.message : String(error)}`); }
}

/**
 * docker-agent YAML through the `yaml` Document API: parsing reports syntax errors with positions and locates JSON
 * pointers in the source; adding an agent inserts its text after the last agent so every other byte, comments
 * included, stays as written.
 */
export const yamlDefinitions: DefinitionCodec = {
  parse(text: string): ParsedDefinition {
    const lineCounter = new LineCounter();
    const document = parseDocument(text, { ...parseOptions, lineCounter });
    const locate = (path: string) => {
      const node = locateNode(document, path);
      if (!node?.range) return undefined;
      const position = lineCounter.linePos(node.range[0]);
      return { line: position.line, column: position.col };
    };
    if (document.errors.length > 0) {
      return {
        locate, diagnostics: document.errors.map(error => ({
          ...diagnostic('error', 'yaml-syntax', '', error.message.split('\n')[0]!),
          ...(error.linePos ? { line: error.linePos[0].line, column: error.linePos[0].col } : {}),
        })),
      };
    }
    try { return { value: document.toJS({ maxAliasCount }) as unknown, diagnostics: [], locate }; }
    catch (error) {
      // Aliases that expand beyond the limit (a "billion laughs" document) fail this file only.
      return { locate, diagnostics: [diagnostic('error', 'yaml-syntax', '', `The YAML cannot be expanded: ${error instanceof Error ? error.message : String(error)}`)] };
    }
  },

  addAgent(text: string, name: string, agent: Record<string, unknown>): string {
    const document = parseDocument(text, parseOptions);
    ensure(document.errors.length === 0, 'INVALID_YAML', `Cannot add an agent to a file with YAML errors: ${document.errors[0]?.message ?? ''}`);
    const original = expanded(document);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const expected = { ...original, agents: { ...(isObject(original.agents) ? original.agents : {}), [name]: agent } };
    const agents = document.get('agents', true);
    const style = layout(text);
    if (isMap(agents) && !agents.flow && agents.items.length > 0 && agents.range) {
      const lineCounter = new LineCounter();
      parseDocument(text, { ...parseOptions, lineCounter });
      const column = lineCounter.linePos((agents.items[0]!.key as Node).range![0]).col - 1;
      let at = agents.range[1];
      if (at > 0 && text[at - 1] !== '\n') { const end = text.indexOf('\n', at); at = end < 0 ? text.length : end + 1; }
      const prefix = at === text.length && !text.endsWith('\n') ? eol : '';
      const block = stringify({ [name]: agent }, { lineWidth: 0, indent: style.indent, indentSeq: style.indentSeq })
        .split('\n').map(line => line === '' ? line : `${' '.repeat(column)}${line}`).join(eol);
      const spacer = /\r?\n\r?\n$/.test(text.slice(0, at)) ? '' : eol;
      const edited = `${text.slice(0, at)}${prefix}${spacer}${block}${text.slice(at)}`;
      const check = parseDocument(edited, parseOptions);
      if (check.errors.length === 0 && same(expanded(check), expected)) return edited;
    }
    // Flow-style or empty agents maps are rewritten through the Document API, which still keeps comments.
    document.setIn(['agents', name], document.createNode(agent));
    const edited = document.toString({ lineWidth: 0, indent: style.indent, indentSeq: style.indentSeq }).replace(/\r?\n/g, eol);
    ensure(same(expanded(parseDocument(edited, parseOptions)), expected), 'OPERATION_FAILED', 'Adding the agent would change other definitions; edit the file by hand.');
    return edited;
  },

  render(document: AgentConfigDocument): string {
    return header + stringify(document, { lineWidth: 0 });
  },
};
