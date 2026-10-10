import { inPlan, type BacklogItem, type BacklogModel } from './model.ts';
import { byName, isDeliverableType } from './vocabulary.ts';
import { menuValues, type BacklogSettings } from './settings.ts';

/**
 * One board column (backlog-view's `BoardColumn`). The first column holds items without a state; moving a card
 * there deletes the state key. Columns follow the configured `stateValues`, else the observed values plus a done
 * value; observed values outside the workflow get columns of their own at the end.
 */
export interface BoardColumn {
  state: string | null; done: boolean; outsideWorkflow: boolean;
  limit: number | null; policy: string; cards: BacklogItem[];
  /** Result cards in the column (context cards are not counted). */
  count: number;
  /** Plan items the board owns in this column, measured against the WIP limit. */
  held: number;
}

/** Observed states, first spelling kept, sorted open first then done (locale order). */
export function observedStates(items: readonly BacklogItem[], settings: BacklogSettings): string[] {
  const seen = new Map<string, string>();
  for (const item of items) if (!item.outsideFilter && item.stateValue !== null && !seen.has(item.stateValue.toLowerCase())) seen.set(item.stateValue.toLowerCase(), item.stateValue);
  const sorted = [...seen.values()].sort((a, b) => a.localeCompare(b));
  const done = (value: string) => settings.doneValues.some(entry => entry.toLowerCase() === value.toLowerCase());
  return [...sorted.filter(value => !done(value)), ...sorted.filter(done)];
}

/** The requirements board: plan results except Deliverables, which have their own board. */
export function requirementsBoard(model: BacklogModel, settings: BacklogSettings): BoardColumn[] {
  const observed = observedStates(model.results.filter(item => !isDeliverableType(item.typeName)), settings);
  const values = menuValues(settings.states, settings.doneValues, observed);
  const column = (state: string | null, outsideWorkflow: boolean): BoardColumn => ({
    state, outsideWorkflow, done: state !== null && settings.doneValues.some(value => value.toLowerCase() === state.toLowerCase()),
    limit: byName(settings.wipLimits, state) ?? null, policy: byName(settings.columnPolicies, state) ?? '', cards: [], count: 0, held: 0,
  });
  const noState = column(null, false);
  const columns = [noState, ...values.map(state => column(state, false))];
  const byValue = new Map(columns.filter(col => col.state !== null).map(col => [col.state!.toLowerCase(), col]));
  for (const value of observed) {
    if (byValue.has(value.toLowerCase())) continue;
    const col = column(value, true);
    byValue.set(value.toLowerCase(), col);
    columns.push(col);
  }
  const columnFor = (card: BacklogItem) => (card.stateValue !== null ? byValue.get(card.stateValue.toLowerCase()) : undefined) ?? noState;
  for (const card of model.results) {
    if (isDeliverableType(card.typeName)) continue;
    const col = columnFor(card);
    col.cards.push(card);
    if (inPlan(card)) col.held++;
  }
  for (const col of columns) {
    col.cards.sort((a, b) => a.entryIndex - b.entryIndex);
    col.count = col.cards.filter(card => !card.outsideFilter).length;
  }
  return columns;
}
