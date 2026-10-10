import {
  compileExpression, compileFormulaSet, compatibilityProfile, fileValue, fromJs, errorValue, nullValue, boolValue,
  stringifyValue, toPlain, type CompiledExpression, type Diagnostic, type RuntimeValue,
} from 'obsidian-bases-expression';
import type { BasesQueryEngine, BasesQueryOptions, BasesQueryResult } from '../../application/bases/query.ts';
import type { DocumentCodec } from '../../application/workspace/ports.ts';
import type { MetadataCache } from '../../application/metadata/ports.ts';
import { forgeError, errorMessage, ensure, isRecord } from '../../domain/shared/errors.ts';
import { NodeFiles } from '../workspace/files.ts';
import { BaseRowContexts } from './contexts.ts';
import { basePropertyTypes, indexBaseFiles } from './index.ts';
import { baseExpression, baseFilter, internalContext, internalFormula, internalTag, internalGuard } from './expressions.ts';

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
// First position of each visible group value, as Array#findIndex reports it.
function positions(groupOrder: readonly unknown[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const [index, value] of groupOrder.entries()) {
    const identity = groupIdentity(value);
    if (!result.has(identity)) result.set(identity, index);
  }
  return result;
}

export class NodeBasesQueryEngine implements BasesQueryEngine {
  /** `metadata` supplies the invocation's kernel metadata cache, built from the same root as `files`. */
  constructor(private readonly files: NodeFiles, private readonly codec: DocumentCodec, private readonly metadata: () => Promise<MetadataCache>) {}
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
        'Links resolve by path through the kernel metadata cache; ambiguous basename links fail explicitly and alias-only links stay unresolved.',
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
    const indexed = await indexBaseFiles(this.files, await this.metadata());
    const contextPath = options.context ?? path;
    const thisFile = indexed.find(file => file.path === contextPath);
    ensure(thisFile, 'BASE_CONTEXT_NOT_FOUND', `Base context is not an indexed vault file: ${contextPath}`);
    const propertyTypes = await basePropertyTypes(this.files);
    const contextNote = Object.fromEntries(Object.entries(thisFile.properties ?? {}).map(([name, value]) => [name, value === null || value === '' ? fromJs(value) : fromJs(value, propertyTypes[name])]));
    const objects = { [internalContext]: { file: fileValue(thisFile), note: contextNote } };
    const compiledFormulaByName = new Map(Object.entries(formulaAsts).map(([name, ast]) => [name, compileExpression(ast)]));
    const groupPositions = groupOrder && positions(groupOrder);
    const rows: Row[] = [];
    for (const { file, context } of new BaseRowContexts(indexed, { thisFile, formulas: formulaAsts, propertyTypes, objects, now: new Date() }).rows()) {
      try {
        const evaluating = new Set<string>();
        let evaluationError: string | undefined;
        context.functions = { [internalFormula]: name => {
          const key = stringifyValue(name);
          if (evaluating.has(key)) return errorValue(`Circular formula reference: ${key}`);
          const formula = compiledFormulaByName.get(key);
          if (!formula) return nullValue();
          evaluating.add(key);
          try { return formula.evaluateValue(context, strict); }
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
        const groupIndex = groupPositions && (groupPositions.size === 0 ? -1 : groupPositions.get(groupIdentity(group && toPlain(group))) ?? -1);
        if (groupIndex === -1) continue;
        const sort = sorts.map(item => item.expression.evaluateValue(context, strict));
        ensure(evaluationError === undefined, 'BASE_EVALUATION_ERROR', evaluationError ?? 'Expression evaluation failed.');
        rows.push({ path: file.path, sort, group, groupIndex });
      } catch (error) {
        throw forgeError('BASE_EVALUATION_ERROR', `${path}, view ${String(view.name)}, file ${file.path}: ${errorMessage(error)}`);
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
