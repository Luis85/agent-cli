import { Script, createContext } from 'node:vm';
import type { SearchBudget } from '../application/search.ts';
import { searchError } from '../domain/query.ts';

/**
 * A time budget for synchronous matching. Each task runs through `node:vm` with the remaining budget as its
 * timeout, whose watchdog interrupts even a catastrophically backtracking regular expression; the tasks of one
 * search share the budget. Exceeding it throws SEARCH_TIMEOUT, so a search never returns partial results.
 */
export function vmSearchBudget(milliseconds: number): SearchBudget {
  const context = createContext({ task: undefined }), script = new Script('task()');
  let spent = 0;
  const timeout = () => searchError('SEARCH_TIMEOUT', `The search exceeded its ${milliseconds} ms matching budget.`, { timeoutMs: milliseconds });
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
