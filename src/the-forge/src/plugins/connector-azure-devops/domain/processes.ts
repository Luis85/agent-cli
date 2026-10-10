import type { ConnectorMapping, SyncField } from '../../../domain/connectors/items.ts';

export type Process = 'agile' | 'scrum' | 'basic' | 'custom';
export const PROCESSES: readonly Process[] = ['agile', 'scrum', 'basic', 'custom'];

/** The Azure DevOps link type of a parent link (seen from the child) and of a predecessor (dependency). */
export const PARENT_LINK = 'System.LinkTypes.Hierarchy-Reverse';
export const PREDECESSOR_LINK = 'System.LinkTypes.Dependency-Reverse';

/**
 * Local backlog types → work item types per process. Basic has only Epic, Issue and Task; a Feature files as an
 * Epic there. Reading back, a remote type maps to the first local type listed for it.
 */
const types: Record<Process, Record<string, string>> = {
  agile: { Epic: 'Epic', Feature: 'Feature', PBI: 'User Story', Task: 'Task', Bug: 'Bug', Issue: 'Issue' },
  scrum: { Epic: 'Epic', Feature: 'Feature', PBI: 'Product Backlog Item', Task: 'Task', Bug: 'Bug', Issue: 'Impediment' },
  basic: { Epic: 'Epic', Feature: 'Epic', PBI: 'Issue', Issue: 'Issue', Bug: 'Issue', Task: 'Task' },
  custom: {},
};

/**
 * Local states → remote states per process. The process's own state names map to themselves and come first, so
 * they win when a remote state is read back; common backlog vocabulary (Open, Active, In Progress, Done) follows.
 * `Task:` entries apply to local Tasks, whose workflow differs in Scrum.
 */
const states: Record<Process, Record<string, string>> = {
  agile: { New: 'New', Active: 'Active', Resolved: 'Resolved', Closed: 'Closed', Removed: 'Removed', Open: 'New', 'To Do': 'New', 'In Progress': 'Active', Done: 'Closed' },
  scrum: {
    New: 'New', Approved: 'Approved', Committed: 'Committed', Done: 'Done', Removed: 'Removed', Open: 'New', 'To Do': 'New', Active: 'Committed', 'In Progress': 'Committed', Closed: 'Done',
    'Task:To Do': 'To Do', 'Task:In Progress': 'In Progress', 'Task:Done': 'Done', 'Task:Removed': 'Removed', 'Task:New': 'To Do', 'Task:Open': 'To Do', 'Task:Active': 'In Progress', 'Task:Closed': 'Done',
  },
  basic: { 'To Do': 'To Do', Doing: 'Doing', Done: 'Done', New: 'To Do', Open: 'To Do', Active: 'Doing', 'In Progress': 'Doing', Closed: 'Done' },
  custom: {},
};

const effort: Record<Process, string> = {
  agile: 'Microsoft.VSTS.Scheduling.StoryPoints', scrum: 'Microsoft.VSTS.Scheduling.Effort', basic: 'Microsoft.VSTS.Scheduling.Effort', custom: 'Microsoft.VSTS.Scheduling.Effort',
};

function fields(process: Process): Record<SyncField, string | null> {
  return {
    title: 'System.Title', type: 'System.WorkItemType', state: 'System.State', parent: PARENT_LINK, iteration: 'System.IterationPath',
    priority: 'Microsoft.VSTS.Common.Priority', effort: effort[process], tags: 'System.Tags', description: 'System.Description',
  };
}

export interface MappingOverrides { types?: Record<string, string>; states?: Record<string, string>; fields?: Record<string, string>; properties?: Record<string, string> }

/** The process defaults merged with a connection's overrides; an empty field reference stops syncing that field. */
export function processMapping(process: Process, overrides: MappingOverrides = {}): ConnectorMapping {
  const resolved = fields(process);
  for (const [field, reference] of Object.entries(overrides.fields ?? {})) if (Object.hasOwn(resolved, field)) resolved[field as SyncField] = reference.trim() === '' ? null : reference.trim();
  return {
    types: { ...types[process], ...overrides.types },
    states: { ...states[process], ...overrides.states },
    fields: resolved,
    properties: { ...overrides.properties },
  };
}

/** Unknown override keys under `mappings.fields`, which are neither neutral fields nor allowed. */
export function unknownFields(overrides: MappingOverrides): string[] {
  const known = Object.keys(fields('agile'));
  return Object.keys(overrides.fields ?? {}).filter(field => !known.includes(field));
}
