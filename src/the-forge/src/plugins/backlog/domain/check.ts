import { reversedSpan } from './fields.ts';
import type { BacklogItem, BacklogModel } from './model.ts';
import { configProblems, type BacklogSettings } from './settings.ts';
import { isIterationType, isResourceType, mayHoldField, placementEnds, type HeldField } from './vocabulary.ts';

/** One finding of `backlog check`. `path` names the note; `value` the raw text or key at fault. */
export interface CheckProblem { code: string; severity: 'error' | 'warning'; path?: string; key?: string; value?: string; paths?: string[]; message: string }

export interface CheckInput {
  model: BacklogModel; settings: BacklogSettings;
  /** Release configuration problems (release view) and membership paths that do not resolve to one Release. */
  releaseProblems: string[]; unresolvedMemberships: string[];
  typeOf(path: string): string | null;
}

const error = (code: string, message: string, extra: Partial<CheckProblem> = {}): CheckProblem => ({ code, severity: 'error', message, ...extra });
const warning = (code: string, message: string, extra: Partial<CheckProblem> = {}): CheckProblem => ({ code, severity: 'warning', message, ...extra });

function linkProblems(item: BacklogItem, input: CheckInput): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const { settings } = input;
  if (item.cycleCut) problems.push(error('parent-cycle', `${item.title} closes a parent loop; the loop is cut here and the note shows as a root.`, { path: item.path, key: settings.parentKey }));
  else if (item.orphan) problems.push(error('unresolved-parent', `The parent of ${item.title} does not resolve to a loaded note.`, { path: item.path, key: settings.parentKey }));
  for (const broken of item.brokenPrerequisites) {
    problems.push(error(broken.reason === 'cycle' ? 'dependency-cycle' : 'unresolved-dependency',
      broken.reason === 'cycle' ? `${item.title} depends on ${broken.raw}, which closes a dependency loop.` : `${item.title} depends on ${broken.raw}, which does not resolve to a loaded item.`,
      { path: item.path, key: settings.dependsOnKey, value: broken.raw }));
  }
  const iteration = item.iterationEntry;
  if (iteration && (iteration.path === null || !isIterationType(input.typeOf(iteration.path)))) {
    problems.push(error('broken-iteration', `The iteration of ${item.title} (${iteration.raw}) is not an Iteration note.`, { path: item.path, key: settings.iterationKey, value: iteration.raw }));
  }
  const assignee = item.assigneeEntry;
  if (assignee && (assignee.path === null || !isResourceType(input.typeOf(assignee.path)))) {
    problems.push(warning('broken-assignee', `The assignee of ${item.title} (${assignee.raw}) is not a Resource note.`, { path: item.path, key: settings.assigneeKey, value: assignee.raw }));
  }
  return problems;
}

function fieldProblems(item: BacklogItem, settings: BacklogSettings): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const held: [HeldField, boolean, string][] = [
    ['release', item.releaseEntry !== null || item.releaseMultiple, settings.releaseKey], ['horizon', item.ownKeys.horizon && item.horizon.value !== null, settings.horizonKey],
    ['iteration', item.ownKeys.iteration && item.iterationEntry !== null, settings.iterationKey], ['iterationGoal', item.iterationGoalValue !== null, settings.iterationGoalKey],
  ];
  for (const [field, present, key] of held) {
    if (present && !mayHoldField(item.typeName, field, settings.iterationBars)) problems.push(error('field-not-held', `${item.typeName ?? 'This type'} ${item.title} may not hold ${key}.`, { path: item.path, key }));
  }
  // The dates a type may store (`schemaEnds`): an iteration keeps its start even while it draws as a point.
  const ends = placementEnds(item.typeName, true);
  for (const [end, reading, key] of [['start', item.plannedStart, settings.startKey], ['target', item.plannedTarget, settings.targetKey]] as const) {
    if (reading.value !== null && !ends.includes(end)) problems.push(error('field-not-held', `${item.typeName ?? 'This type'} ${item.title} may not hold ${key}.`, { path: item.path, key }));
    if (reading.invalid) problems.push(warning('unreadable-date', `${item.title} has an unreadable ${key}; the plugin shelves it.`, { path: item.path, key }));
  }
  if (item.horizon.invalid) problems.push(warning('unreadable-horizon', `${item.title} has an unreadable ${settings.horizonKey}; the plugin shelves it.`, { path: item.path, key: settings.horizonKey }));
  if (reversedSpan(item.plannedStart.value, item.plannedTarget.value)) problems.push(warning('reversed-span', `${item.title} starts after its target date.`, { path: item.path }));
  return problems;
}

/**
 * `backlog check`: parent and dependency loops, broken links, unresolved release memberships, configuration
 * problems, fields a type may not hold, unreadable values and rank ties or gaps. It never writes.
 */
export function checkBacklog(input: CheckInput): CheckProblem[] {
  const { model, settings } = input;
  const problems: CheckProblem[] = [
    ...configProblems(settings).map(message => error('config', message)),
    ...input.releaseProblems.map(message => error('release-config', message)),
  ];
  const results = model.items.filter(item => !item.outsideFilter);
  for (const item of results) problems.push(...linkProblems(item, input), ...fieldProblems(item, settings));
  for (const path of input.unresolvedMemberships) problems.push(error('unresolved-membership', `The release membership of ${path} does not resolve to exactly one Release note of this base.`, { path }));
  const byOrder = new Map<number, string[]>();
  for (const item of results) if (item.order !== null) byOrder.set(item.order, [...(byOrder.get(item.order) ?? []), item.path]);
  for (const [order, paths] of byOrder) if (paths.length > 1) problems.push(warning('rank-tie', `${paths.length} items share rank ${order}; ties follow result order.`, { value: String(order), paths }));
  const unranked = results.filter(item => item.order === null).map(item => item.path);
  if (unranked.length > 0) problems.push(warning('unranked', `${unranked.length} items have no rank and sort last; run backlog ranks seed.`, { paths: unranked }));
  return problems;
}
