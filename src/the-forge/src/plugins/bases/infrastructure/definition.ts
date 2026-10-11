import type { CompiledExpression, Diagnostic } from 'obsidian-bases-expression';
import { ensure, isRecord } from '../../../domain/shared/errors.ts';
import { baseExpression } from './expressions.ts';

/** A view's sort or groupBy entry with its compiled property access. */
export interface Ordering { property: string; direction: 'ASC' | 'DESC'; expression: CompiledExpression }

/** Fails with INVALID_BASE_EXPRESSION when compilation reported an error or a circular formula. */
export function diagnostics(items: readonly Diagnostic[], label: string): void {
  const failures = items.filter(item => item.severity === 'error' || item.code === 'circular-formula');
  ensure(failures.length === 0, 'INVALID_BASE_EXPRESSION', `${label}: ${failures.map(item => item.message).join('; ')}`);
}

/** Compiles one `{property, direction}` sort or groupBy entry; `note.`, `file.` and `formula.` properties are accepted. */
export function ordering(value: unknown): Ordering {
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
