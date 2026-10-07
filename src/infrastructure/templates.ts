import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
import localizedFormat from 'dayjs/plugin/localizedFormat.js';
import { isMap, isScalar, parseDocument, visit } from 'yaml';
import type { DocumentTemplates, TemplateInspection, TemplateOptions } from '../application/templates.ts';
import { AppError, ensure, isRecord } from '../domain/errors.ts';
import { parseMarkdownParts } from './documents.ts';

dayjs.extend(utc);
dayjs.extend(advancedFormat);
dayjs.extend(localizedFormat);

interface Placeholder { expression: string; key: string; format?: string; start: number; end: number }

function textOf(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new AppError('INVALID_ENCODING', 'Templates must be valid UTF-8.', 2); }
}

function placeholders(text: string): Placeholder[] {
  const result: Placeholder[] = [];
  const braces = /{{|}}/g;
  for (let match = braces.exec(text); match; match = braces.exec(text)) {
    ensure(match[0] === '{{', 'INVALID_TEMPLATE', 'Unexpected closing template braces.');
    const close = text.indexOf('}}', braces.lastIndex);
    ensure(close >= 0, 'INVALID_TEMPLATE', 'Unclosed template placeholder.');
    const expression = text.slice(braces.lastIndex, close).trim();
    const parsed = /^([A-Za-z_][\w.-]*)(?::([^{}\r\n]+))?$/.exec(expression);
    ensure(parsed, 'INVALID_TEMPLATE', `Invalid template placeholder: {{${expression}}}.`);
    const key = parsed[1]!, format = parsed[2];
    ensure(format === undefined || key === 'date' || key === 'time', 'INVALID_TEMPLATE', 'Only date and time placeholders accept a format.');
    result.push({ expression, key, ...(format === undefined ? {} : { format }), start: match.index, end: close + 2 });
    braces.lastIndex = close + 2;
  }
  return result;
}

function replaceTokens(text: string, tokens: Placeholder[], value: (token: Placeholder, index: number) => string): string {
  let cursor = 0, output = '';
  for (const [index, token] of tokens.entries()) {
    output += text.slice(cursor, token.start) + value(token, index);
    cursor = token.end;
  }
  return output + text.slice(cursor);
}

function jsonValue(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  ensure(depth < 100, 'INVALID_TEMPLATE_VALUES', 'Template values are nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { ensure(Number.isFinite(value), 'INVALID_TEMPLATE_VALUES', 'Template numbers must be finite.'); return; }
  ensure(typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'INVALID_TEMPLATE_VALUES', 'Template values must be JSON-compatible.');
  ensure(!ancestors.has(value), 'INVALID_TEMPLATE_VALUES', 'Template values cannot contain cycles.');
  ancestors.add(value);
  for (const child of Object.values(value)) jsonValue(child, ancestors, depth + 1);
  ancestors.delete(value);
}

function asText(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value); }

/** Parse the authored YAML first, then modify values through its AST: interpolation cannot inject YAML structure. */
function renderYaml(source: string, resolve: (token: Placeholder) => unknown): string {
  const tokens = placeholders(source);
  const resolved = tokens.map(resolve);
  const serializedValues = JSON.stringify(resolved);
  let prefix = 'AGENTCLITEMPLATETOKEN';
  while (source.includes(prefix) || serializedValues.includes(prefix)) prefix += 'X';
  const sentinels = tokens.map((_, index) => `${prefix}${index}END`);
  const document = parseDocument(replaceTokens(source, tokens, (_, index) => sentinels[index]!), { uniqueKeys: true });
  ensure(document.errors.length === 0, 'INVALID_TEMPLATE', document.errors.map(error => error.message).join('; '));
  ensure(document.contents === null || isMap(document.contents), 'INVALID_TEMPLATE', 'Template frontmatter must be a YAML mapping.');
  const consumed = new Set<number>();
  const sentinelPattern = new RegExp(`${prefix}(\\d+)END`, 'g');
  visit(document, (key, node, path) => {
    ensure(path.length < 100, 'INVALID_TEMPLATE', 'Template YAML is nested too deeply.');
    if (key === 'key') {
      ensure(isScalar(node) && typeof node.value === 'string', 'INVALID_TEMPLATE', 'Template YAML keys must be strings.');
      ensure(!node.value.includes(prefix), 'INVALID_TEMPLATE', 'Template placeholders cannot be used in YAML keys.');
    }
    if (!isScalar(node) || typeof node.value !== 'string' || key === 'key') return;
    const scalar = node.value;
    const exact = sentinels.indexOf(scalar);
    if (exact >= 0) {
      consumed.add(exact);
      const replacement = document.createNode(resolved[exact]);
      replacement.comment = node.comment;
      replacement.commentBefore = node.commentBefore;
      replacement.spaceBefore = node.spaceBefore;
      replacement.anchor = node.anchor;
      return replacement;
    }
    node.value = scalar.replace(sentinelPattern, (_, index: string) => {
      const position = Number(index);
      consumed.add(position);
      return asText(resolved[position]);
    });
  });
  ensure(consumed.size === tokens.length, 'INVALID_TEMPLATE', 'Placeholders in frontmatter are supported only in scalar values, not comments, tags or anchors.');
  let data: unknown;
  try { data = document.toJS({ maxAliasCount: 100 }); }
  catch { throw new AppError('INVALID_TEMPLATE', 'Template YAML aliases are invalid or excessive.', 2); }
  try { jsonValue(data); }
  catch { throw new AppError('INVALID_TEMPLATE', 'Template YAML must contain JSON-compatible values without cycles.', 2); }
  return document.toString();
}

function instant(date: string | undefined) {
  if (date === undefined) return dayjs.utc();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(date);
  ensure(match, 'INVALID_TEMPLATE_DATE', 'Use an ISO date (YYYY-MM-DD) or timestamp with an explicit timezone.');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month, 0);
  const daysInMonth = calendar.getUTCDate();
  const parsed = dayjs.utc(date);
  ensure(month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && Number(match[4] ?? 0) < 24 && Number(match[5] ?? 0) < 60 && Number(match[6] ?? 0) < 60 && parsed.isValid(), 'INVALID_TEMPLATE_DATE', 'Template date is not a valid calendar date.');
  return parsed;
}

export class MarkdownTemplates implements DocumentTemplates {
  inspect(bytes: Uint8Array): TemplateInspection {
    const parts = parseMarkdownParts(textOf(bytes));
    const tokens = [...placeholders(parts.yaml), ...placeholders(parts.body)];
    if (parts.exists) renderYaml(parts.yaml, token => `{{${token.expression}}}`);
    const builtin = (token: Placeholder) => ['title', 'date', 'time'].includes(token.key);
    return {
      variables: [...new Set(tokens.map(token => token.expression))].sort(),
      requiredVariables: [...new Set(tokens.filter(token => !builtin(token)).map(token => token.key))].sort(),
      builtins: [...new Set(tokens.filter(builtin).map(token => token.expression))].sort(),
    };
  }

  render(bytes: Uint8Array, options: TemplateOptions): Uint8Array {
    ensure(typeof options.title === 'string' && options.title.trim().length > 0, 'INVALID_TEMPLATE_VALUES', 'A nonempty template title is required.');
    const values = options.values ?? {};
    ensure(isRecord(values), 'INVALID_TEMPLATE_VALUES', 'Template values must be a JSON object.');
    jsonValue(values);
    for (const key of ['title', 'date', 'time']) ensure(!Object.hasOwn(values, key), 'INVALID_TEMPLATE_VALUES', `${key} is reserved; use the corresponding template option.`);
    const date = instant(options.date);
    for (const format of [options.dateFormat, options.timeFormat]) ensure(format === undefined || (typeof format === 'string' && format.length > 0), 'INVALID_TEMPLATE_DATE', 'Date and time formats must be nonempty strings.');
    const resolve = (token: Placeholder): unknown => {
      if (token.key === 'title') return options.title;
      if (token.key === 'date' || token.key === 'time') {
        const format = token.format ?? (token.key === 'date' ? options.dateFormat ?? 'YYYY-MM-DD' : options.timeFormat ?? 'HH:mm');
        try { return date.format(format); }
        catch { throw new AppError('INVALID_TEMPLATE_DATE', `Unsupported date format: ${format}.`, 2); }
      }
      ensure(Object.hasOwn(values, token.key), 'UNKNOWN_TEMPLATE_VARIABLE', `Missing template value: ${token.key}.`);
      return values[token.key];
    };
    const parts = parseMarkdownParts(textOf(bytes));
    const body = replaceTokens(parts.body, placeholders(parts.body), token => asText(resolve(token)));
    const frontmatter = parts.exists ? `---${parts.newline}${renderYaml(parts.yaml, resolve).replace(/\r?\n/g, parts.newline)}---${parts.newline}` : '';
    return new TextEncoder().encode(parts.prefix + frontmatter + body);
  }
}
