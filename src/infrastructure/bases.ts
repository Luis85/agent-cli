import {
  compileExpression, compileFormulaSet, createEvaluationContext, compatibilityProfile, fileValue, fromJs, errorValue, nullValue, boolValue,
  stringifyValue, toPlain, type CompiledExpression, type Diagnostic, type RuntimeValue,
} from 'obsidian-bases-expression';
import type { BasesQueryEngine, BasesQueryOptions, BasesQueryResult } from '../application/bases.ts';
import type { DocumentCodec } from '../application/ports.ts';
import { AppError, ensure, isRecord } from '../domain/errors.ts';
import { NodeFiles } from './files.ts';
import { basePropertyTypes, indexBaseFiles } from './bases-index.ts';
import { baseExpression, baseFilter, internalContext, internalFormula, internalTag, internalGuard } from './bases-expressions.ts';

interface Ordering { property: string; direction: 'ASC' | 'DESC'; expression: CompiledExpression }
interface Row { path: string; sort: RuntimeValue[]; group?: RuntimeValue; groupIndex?: number }
const strict = { throwOnError: true };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function diagnostics(items: readonly Diagnostic[], label: string): void {
  const failures = items.filter(item => item.severity === 'error' || item.code === 'circular-formula');
  ensure(failures.length === 0, 'INVALID_BASE_EXPRESSION', `${label}: ${failures.map(item => item.message).join('; ')}`);
}
function ordering(value: unknown): Ordering {
  ensure(isRecord(value) && typeof value.property === 'string' && value.property.length > 0, 'INVALID_BASE_QUERY', 'Sort and groupBy entries need a property name.');
  ensure(value.direction === 'ASC' || value.direction === 'DESC', 'INVALID_BASE_QUERY', 'Sort and groupBy direction must be ASC or DESC.');
  const property = value.property;
  const dot = property.indexOf('.');
  const namespace = dot < 0 ? 'note' : property.slice(0, dot);
  const name = dot < 0 ? property : property.slice(dot + 1);
  ensure(['note', 'file', 'formula'].includes(namespace) && name.length > 0, 'INVALID_BASE_QUERY', `Invalid property identifier: ${property}`);
  const expression = baseExpression(`${namespace}[${JSON.stringify(name)}]`);
  diagnostics(expression.diagnostics, property);
  return { property, direction: value.direction, expression };
}
function compare(a: RuntimeValue, b: RuntimeValue): number {
  if (a.type === 'Null' || b.type === 'Null') return a.type === b.type ? 0 : a.type === 'Null' ? -1 : 1;
  if (a.type === 'Date' && b.type === 'Date') return a.value.getTime() - b.value.getTime();
  if (a.type === 'Number' && b.type === 'Number') return a.value - b.value;
  if (a.type === 'Boolean' && b.type === 'Boolean') return Number(a.value) - Number(b.value);
  return collator.compare(stringifyValue(a), stringifyValue(b));
}
function groupIdentity(value: unknown): string { return JSON.stringify(value ?? null); }

export class NodeBasesQueryEngine implements BasesQueryEngine {
  constructor(private readonly files: NodeFiles, private readonly codec: DocumentCodec) {}
  capabilities(): Record<string, unknown> {
    return {
      engine: 'obsidian-bases-expression', version: '0.2.0', standalone: true,
      expressions: compatibilityProfile,
      query: ['global-and-view-filters', 'formulas', 'sort', 'limit', 'groupBy', 'groupOrder', 'this-context', 'property-types', 'tags', 'links', 'embeds', 'backlinks', 'attachments'],
      limits: [
        'Independent implementation; not verified against a running Obsidian installation by The Forge.',
        'Community-plugin functions and view-specific query behavior are not loaded.',
        'Display columns, summaries and presentation settings do not change the returned file list.',
        'Dot-prefixed paths, node_modules, symlinks and Forge temporary/lock files are excluded.',
        'Ambiguous unresolved basename links fail explicitly; no Obsidian metadata cache is available.',
        'Rows sort by typed values with host-locale natural string collation; equal keys use file path.',
        'The filesystem is indexed once per invocation, without a transactional snapshot or live refresh.',
      ],
    };
  }
  async query(path: string, options: BasesQueryOptions): Promise<BasesQueryResult> {
    const base = (this.codec.inspect(path, (await this.files.read(path)).bytes) as { data: Record<string, unknown> }).data;
    const views = (base.views ?? []) as Record<string, unknown>[];
    ensure(views.length > 0, 'BASE_VIEW_NOT_FOUND', `No views are defined in ${path}.`);
    ensure(new Set(views.map(view => view.name)).size === views.length, 'INVALID_BASE_QUERY', 'Base view names must be unique.');
    const view = options.view === undefined ? views[0] : views.find(item => item.name === options.view);
    ensure(view, 'BASE_VIEW_NOT_FOUND', `View ${options.view ?? ''} is not defined in ${path}.`);
    const formulas = (base.formulas ?? {}) as Record<string, string>;
    const formulaAsts = Object.fromEntries(Object.entries(formulas).map(([name, source]) => [name, baseExpression(source).ast!]));
    const compiledFormulas = compileFormulaSet(formulaAsts);
    diagnostics(compiledFormulas.diagnostics, 'Formulas');
    const globalFilter = baseFilter(base.filters), viewFilter = baseFilter(view.filters);
    ensure(view.sort === undefined || Array.isArray(view.sort), 'INVALID_BASE_QUERY', 'View sort must be a list of property/direction entries.');
    const sorts = ((view.sort ?? []) as unknown[]).map(ordering);
    const grouping = view.groupBy === undefined ? undefined : ordering(view.groupBy);
    ensure(view.groupOrder === undefined || (grouping !== undefined && Array.isArray(view.groupOrder)), 'INVALID_BASE_QUERY', 'groupOrder requires groupBy and a list of visible group values.');
    const groupOrder = view.groupOrder as unknown[] | undefined;
    const indexed = await indexBaseFiles(this.files, this.codec);
    const contextPath = options.context ?? path;
    const thisFile = indexed.find(file => file.path === contextPath);
    ensure(thisFile, 'BASE_CONTEXT_NOT_FOUND', `Base context is not an indexed vault file: ${contextPath}`);
    const propertyTypes = await basePropertyTypes(this.files);
    const contextNote = Object.fromEntries(Object.entries(thisFile.properties ?? {}).map(([name, value]) => [name, value === null || value === '' ? fromJs(value) : fromJs(value, propertyTypes[name])]));
    const now = new Date();
    const rows: Row[] = [];
    for (const file of indexed) {
      try {
        const linkResolutions = Object.fromEntries((file.links ?? []).map(link => [link.path, link.resolvedPath ?? null]));
        const rowTypes = Object.fromEntries(Object.entries(propertyTypes).filter(([name, type]) => type !== 'date' || (file.properties?.[name] !== undefined && file.properties[name] !== null && file.properties[name] !== '')));
        const context = createEvaluationContext({ note: file.properties, file, files: indexed, thisFile, formulas: formulaAsts, propertyTypes: rowTypes, now, linkResolutions, objects: { [internalContext]: { file: fileValue(thisFile), note: contextNote } } });
        const evaluating = new Set<string>();
        let evaluationError: string | undefined;
        context.functions = { [internalFormula]: name => {
          const key = stringifyValue(name);
          if (evaluating.has(key)) return errorValue(`Circular formula reference: ${key}`);
          const ast = Object.hasOwn(formulaAsts, key) ? formulaAsts[key] : undefined;
          if (!ast) return nullValue();
          evaluating.add(key);
          try { return compileExpression(ast).evaluateValue(context, strict); }
          finally { evaluating.delete(key); }
        }, [internalTag]: (receiver, ...tags) => {
          if (receiver.type !== 'File') return errorValue('hasTag requires a file.');
          const normalized = receiver.value.tags.map(tag => tag.replace(/^#/, '').toLocaleLowerCase());
          return boolValue(tags.some(tag => {
            const needle = stringifyValue(tag).replace(/^#/, '').toLocaleLowerCase();
            return normalized.some(value => value === needle || value.startsWith(needle + '/'));
          }));
        }, [internalGuard]: value => {
          if (value.type === 'Error') evaluationError ??= value.value.message;
          return value;
        } };
        const matches = globalFilter(context) && viewFilter(context);
        ensure(evaluationError === undefined, 'BASE_EVALUATION_ERROR', evaluationError ?? 'Expression evaluation failed.');
        if (!matches) continue;
        const group = grouping?.expression.evaluateValue(context, strict);
        const groupIndex = groupOrder?.findIndex(value => groupIdentity(value) === groupIdentity(group && toPlain(group)));
        if (groupIndex === -1) continue;
        const sort = sorts.map(item => item.expression.evaluateValue(context, strict));
        ensure(evaluationError === undefined, 'BASE_EVALUATION_ERROR', evaluationError ?? 'Expression evaluation failed.');
        rows.push({ path: file.path, sort, group, groupIndex });
      } catch (error) {
        throw new AppError('BASE_EVALUATION_ERROR', `${path}, view ${String(view.name)}, file ${file.path}: ${error instanceof Error ? error.message : String(error)}`, 2);
      }
    }
    rows.sort((a, b) => {
      if (grouping && a.group && b.group) {
        const comparison = groupOrder ? a.groupIndex! - b.groupIndex! : compare(a.group, b.group) * (grouping.direction === 'DESC' ? -1 : 1);
        if (comparison) return comparison;
      }
      for (const [index, sort] of sorts.entries()) {
        const comparison = compare(a.sort[index]!, b.sort[index]!) * (sort.direction === 'DESC' ? -1 : 1);
        if (comparison) return comparison;
      }
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
    const limit = Math.min(options.limit ?? Infinity, typeof view.limit === 'number' ? view.limit : Infinity);
    return { path, view: String(view.name), context: contextPath, total: rows.length, files: rows.slice(0, limit).map(row => row.path), compatibility: this.capabilities() };
  }
}
