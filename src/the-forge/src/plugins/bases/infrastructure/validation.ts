import { compileFormulaSet } from 'obsidian-bases-expression';
import { AppError, ensure, errorMessage } from '../../../domain/shared/errors.ts';
import type { BaseDefinitionIssue } from '../application/validation.ts';
import { diagnostics, ordering } from './definition.ts';
import { baseExpression, baseFilter } from './expressions.ts';

/**
 * Every problem `bases query` would reject in a structurally valid `.base` definition before it reads any file:
 * duplicate view names, formulas and filters that do not compile, circular formulas, and invalid sort, groupBy and
 * groupOrder entries. Nothing is evaluated. Issues follow the definition: global problems, then each view in order.
 */
export function baseDefinitionIssues(base: Record<string, unknown>): BaseDefinitionIssue[] {
  const issues: BaseDefinitionIssue[] = [];
  const check = (view: string | undefined, work: () => void, label = '') => {
    try { work(); }
    catch (error) {
      issues.push({ code: error instanceof AppError ? error.code : 'INVALID_BASE_EXPRESSION', message: label + errorMessage(error), ...(view === undefined ? {} : { view }) });
    }
  };
  const views = (base.views ?? []) as Record<string, unknown>[];
  check(undefined, () => ensure(new Set(views.map(view => view.name)).size === views.length, 'INVALID_BASE_QUERY', 'Base view names must be unique.'));
  const formulas = Object.entries((base.formulas ?? {}) as Record<string, string>);
  const asts: Record<string, NonNullable<ReturnType<typeof baseExpression>['ast']>> = {};
  for (const [name, source] of formulas) check(undefined, () => { asts[name] = baseExpression(source).ast!; }, `Formula ${name}: `);
  // Circular references are checked only once every formula compiled on its own.
  if (Object.keys(asts).length === formulas.length) check(undefined, () => diagnostics(compileFormulaSet(asts).diagnostics, 'Formulas'));
  check(undefined, () => baseFilter(base.filters));
  for (const view of views) {
    const name = String(view.name);
    check(name, () => baseFilter(view.filters));
    check(name, () => {
      ensure(view.sort === undefined || Array.isArray(view.sort), 'INVALID_BASE_QUERY', 'View sort must be a list of property/direction entries.');
      ((view.sort ?? []) as unknown[]).forEach(ordering);
    });
    check(name, () => {
      if (view.groupBy !== undefined) ordering(view.groupBy);
      ensure(view.groupOrder === undefined || (view.groupBy !== undefined && Array.isArray(view.groupOrder)), 'INVALID_BASE_QUERY', 'groupOrder requires groupBy and a list of visible group values.');
    });
  }
  return issues;
}
