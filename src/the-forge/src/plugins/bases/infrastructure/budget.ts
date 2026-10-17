import { Script, createContext } from 'node:vm';
import { forgeError } from '../../../domain/shared/errors.ts';

/** Milliseconds one query may spend evaluating filters, formulas, groups and sort keys over all its files. */
export const defaultBaseTimeoutMs = 30_000;

/** Runs synchronous expression evaluation within one query's time budget; exceeding it throws BASE_TIMEOUT. */
export interface EvaluationBudget { run<T>(task: () => T): T }

/**
 * A time budget for one query. Each file's evaluation runs through `node:vm` with the remaining budget as its
 * timeout, whose watchdog interrupts even a catastrophically backtracking regular expression in a `.base` filter;
 * the files of one query share the budget. Exceeding it throws BASE_TIMEOUT, so a query never returns partial rows.
 */
export function vmEvaluationBudget(path: string, milliseconds: number): EvaluationBudget {
  const context = createContext({ task: undefined }), script = new Script('task()');
  let spent = 0;
  const timeout = () => forgeError('BASE_TIMEOUT', `${path}: the query exceeded its ${milliseconds} ms evaluation budget.`, { path, timeoutMs: milliseconds });
  return {
    run<T>(task: () => T): T {
      if (spent >= milliseconds) throw timeout();
      const started = performance.now();
      context.task = task;
      try { return script.runInContext(context, { timeout: Math.max(1, Math.ceil(milliseconds - spent)) }) as T; }
      catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw timeout();
        throw error;
      } finally {
        context.task = undefined;
        spent += performance.now() - started;
      }
    },
  };
}
