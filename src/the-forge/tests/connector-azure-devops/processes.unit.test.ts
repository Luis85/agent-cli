import { describe, expect, it } from 'vitest';
import { PROCESSES, processMapping, unknownFields, type Process } from '../../src/plugins/connector-azure-devops/domain/processes.ts';

/** The neutral fields every process maps to the same Azure DevOps references; only effort differs. */
const sharedFields = (effort: string) => ({
  title: 'System.Title', type: 'System.WorkItemType', state: 'System.State', parent: 'System.LinkTypes.Hierarchy-Reverse', dependencies: 'System.LinkTypes.Dependency-Reverse',
  iteration: 'System.IterationPath', area: 'System.AreaPath', priority: 'Microsoft.VSTS.Common.Priority', effort, tags: 'System.Tags', description: 'System.Description',
});

describe('process defaults', () => {
  it('lists the supported processes', () => {
    expect(PROCESSES).toStrictEqual(['agile', 'scrum', 'basic', 'custom']);
  });

  it.each<[Process, Record<string, string>]>([
    ['agile', { Epic: 'Epic', Feature: 'Feature', PBI: 'User Story', Task: 'Task', Bug: 'Bug', Issue: 'Issue' }],
    ['scrum', { Epic: 'Epic', Feature: 'Feature', PBI: 'Product Backlog Item', Task: 'Task', Bug: 'Bug', Issue: 'Impediment' }],
    ['basic', { Epic: 'Epic', Feature: 'Epic', PBI: 'Issue', Issue: 'Issue', Bug: 'Issue', Task: 'Task' }],
    ['custom', {}],
  ])('maps the local types of %s to its work item types', (process, types) => {
    expect(processMapping(process).types).toStrictEqual(types);
  });

  it.each<[Process, Record<string, string>]>([
    ['agile', { New: 'New', Active: 'Active', Resolved: 'Resolved', Closed: 'Closed', Removed: 'Removed', Open: 'New', 'To Do': 'New', 'In Progress': 'Active', Done: 'Closed' }],
    ['scrum', {
      New: 'New', Approved: 'Approved', Committed: 'Committed', Done: 'Done', Removed: 'Removed', Open: 'New', 'To Do': 'New', Active: 'Committed', 'In Progress': 'Committed', Closed: 'Done',
      'Task:To Do': 'To Do', 'Task:In Progress': 'In Progress', 'Task:Done': 'Done', 'Task:Removed': 'Removed', 'Task:New': 'To Do', 'Task:Open': 'To Do', 'Task:Active': 'In Progress', 'Task:Closed': 'Done',
    }],
    ['basic', { 'To Do': 'To Do', Doing: 'Doing', Done: 'Done', New: 'To Do', Open: 'To Do', Active: 'Doing', 'In Progress': 'Doing', Closed: 'Done' }],
    ['custom', {}],
  ])('maps the local states of %s to its states, its own state names first', (process, states) => {
    const mapped = processMapping(process).states;
    expect(mapped).toStrictEqual(states);
    // Reading back takes the first local state listed for a remote state, so the order is part of the contract.
    expect(Object.keys(mapped)).toStrictEqual(Object.keys(states));
  });

  it.each<[Process, string]>([
    ['agile', 'Microsoft.VSTS.Scheduling.StoryPoints'],
    ['scrum', 'Microsoft.VSTS.Scheduling.Effort'],
    ['basic', 'Microsoft.VSTS.Scheduling.Effort'],
    ['custom', 'Microsoft.VSTS.Scheduling.Effort'],
  ])('maps the neutral fields of %s, with its effort field', (process, effort) => {
    expect(processMapping(process)).toStrictEqual({ types: expect.any(Object), states: expect.any(Object), fields: sharedFields(effort), properties: {} });
  });
});

describe('connection overrides', () => {
  it('merges type, state and property overrides over the process defaults', () => {
    const mapping = processMapping('scrum', { types: { PBI: 'Requirement', Spike: 'Spike' }, states: { Review: 'Resolved', Done: 'Closed' }, properties: { risk: 'Microsoft.VSTS.Common.Risk' } });
    expect(mapping.types).toStrictEqual({ Epic: 'Epic', Feature: 'Feature', PBI: 'Requirement', Task: 'Task', Bug: 'Bug', Issue: 'Impediment', Spike: 'Spike' });
    expect(mapping.states).toMatchObject({ New: 'New', Done: 'Closed', Review: 'Resolved', 'Task:Done': 'Done' });
    expect(mapping.properties).toStrictEqual({ risk: 'Microsoft.VSTS.Common.Risk' });
  });

  it('trims field overrides and stops syncing a field whose override is blank', () => {
    const { fields } = processMapping('agile', { fields: { effort: ' Custom.Size ', description: '  ', tags: '' } });
    expect(fields).toStrictEqual({ ...sharedFields('Custom.Size'), description: null, tags: null });
  });

  it('ignores override keys that are not neutral fields and reports them', () => {
    const overrides = { fields: { effort: 'Custom.Size', storyPoints: 'Custom.Points', toString: 'Custom.X' } };
    expect(processMapping('agile', overrides).fields).toStrictEqual(sharedFields('Custom.Size'));
    expect(unknownFields(overrides)).toStrictEqual(['storyPoints', 'toString']);
    expect(unknownFields({})).toStrictEqual([]);
  });

  it('does not share mutable defaults between mappings', () => {
    const first = processMapping('agile');
    first.types.PBI = 'Changed';
    first.fields.title = 'Changed';
    first.properties.risk = 'Changed';
    expect(processMapping('agile')).toMatchObject({ types: { PBI: 'User Story' }, fields: { title: 'System.Title' }, properties: {} });
    expect(processMapping('agile').properties).toStrictEqual({});
  });
});
