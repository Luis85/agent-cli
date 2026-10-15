import { describe, expect, it } from 'vitest';
import { processMapping, type MappingOverrides } from '../../src/plugins/connector-azure-devops/domain/processes.ts';
import { remoteItem, type PatchContext } from '../../src/plugins/connector-azure-devops/domain/work-items.ts';

const organization = 'https://dev.azure.com/contoso';
const PARENT = 'System.LinkTypes.Hierarchy-Reverse', PREDECESSOR = 'System.LinkTypes.Dependency-Reverse';
const context = (overrides: MappingOverrides = {}): PatchContext => ({ mapping: processMapping('agile', overrides), descriptionFormat: 'markdown', organization, defaultArea: 'Trailhead\\Default' });
const relation = (rel: string, id: number | string) => ({ rel, url: `${organization}/_apis/wit/workItems/${id}` });
/** A work item response with the given fields and relations. */
const read = (fields: Record<string, unknown>, relations: unknown[] = [], overrides: MappingOverrides = {}) => remoteItem({ id: 42, rev: 3, fields, relations }, context(overrides), id => `items/${id}`);

describe('reading a work item', () => {
  it('reads an item with no fields or relations as empty values', () => {
    expect(read({})).toStrictEqual({
      id: '42', rev: '3', url: 'items/42', type: '', title: '', state: null, parentId: null, iteration: null, area: null,
      priority: null, effort: null, tags: [], description: null, descriptionMarkdown: false, dependencies: [], fields: {},
    });
  });

  it.each<[string, unknown, string | null]>([
    ['text', 'Active', 'Active'], ['blank text', '  ', null], ['empty text', '', null], ['a number', 3, null],
  ])('reads %s state and iteration', (_name, value, expected) => {
    expect(read({ 'System.State': value, 'System.IterationPath': value })).toMatchObject({ state: expected, iteration: expected });
  });

  it.each<[string, unknown, number | null]>([
    ['a number', 2, 2], ['zero', 0, 0], ['a decimal', 1.5, 1.5], ['numeric text', '3', 3], ['padded numeric text', ' 4 ', 4],
    ['NaN', Number.NaN, null], ['Infinity', Number.POSITIVE_INFINITY, null], ['text', 'high', null], ['blank text', '  ', null], ['empty text', '', null],
    ['a boolean', true, null], ['null', null, null], ['a list', [1], null],
  ])('reads %s priority and effort', (_name, value, expected) => {
    const item = read({ 'Microsoft.VSTS.Common.Priority': value, 'Microsoft.VSTS.Scheduling.StoryPoints': value });
    expect(item.priority).toBe(expected);
    expect(item.effort).toBe(expected);
  });

  it.each<[string, unknown, string[]]>([
    ['separated tags', 'web; ux', ['web', 'ux']], ['empty entries', 'a;;b ; ', ['a', 'b']], ['blank tags', '  ', []], ['no tags', undefined, []],
  ])('reads %s', (_name, tags, expected) => {
    expect(read({ 'System.Tags': tags }).tags).toStrictEqual(expected);
  });

  it('reads the parent from the parent relation wherever it is, with multi-digit ids at the end of the URL', () => {
    expect(read({}, [relation('System.LinkTypes.Related', 5), relation(PARENT, 1234)]).parentId).toBe('1234');
    expect(read({}, [{ rel: PARENT, url: 'https://srv/tfs/2019/_apis/wit/workItems/7' }]).parentId).toBe('7');
    expect(read({}, [relation('System.LinkTypes.Related', 5)]).parentId).toBeNull();
    expect(read({}, [null, 'x', relation(PARENT, 9)]).parentId).toBe('9');
    const unsynced = read({}, [relation(PARENT, 9)], { fields: { parent: '' } });
    expect(unsynced).toHaveProperty('parentId', undefined);
  });

  it('reads predecessors once each in numeric order and skips links without an id', () => {
    const relations = [relation(PREDECESSOR, 10), relation(PREDECESSOR, 9), relation(PREDECESSOR, 100), relation(PREDECESSOR, 9), relation('System.LinkTypes.Related', 1), { rel: PREDECESSOR, url: 'https://srv/no-id' }];
    expect(read({}, relations).dependencies).toStrictEqual(['9', '10', '100']);
    expect(read({}, [relation(PREDECESSOR, '7'), relation(PREDECESSOR, '007'), relation(PREDECESSOR, '07'), relation(PREDECESSOR, 6)]).dependencies).toStrictEqual(['6', '007', '07', '7']);
    expect(read({}, [relation(PREDECESSOR, '07'), relation(PREDECESSOR, '7'), relation(PREDECESSOR, '007')]).dependencies).toStrictEqual(['007', '07', '7']);
  });

  it('reads the area from System.AreaPath or the mapped field, and the default area as none', () => {
    expect(read({ 'System.AreaPath': 'Trailhead\\Web', 'Custom.Area': 'Custom' }).area).toBe('Trailhead\\Web');
    expect(read({ 'System.AreaPath': 'Trailhead\\Web', 'Custom.Area': 'Custom' }, [], { fields: { area: 'Custom.Area' } }).area).toBe('Custom');
    expect(read({ 'System.AreaPath': 'Trailhead\\Web' }, [], { fields: { area: '' } }).area).toBe('Trailhead\\Web');
    expect(read({ 'System.AreaPath': 'trailhead\\DEFAULT' }).area).toBeNull();
    expect(read({ 'System.AreaPath': 'Trailhead\\Default\\Sub' }).area).toBe('Trailhead\\Default\\Sub');
  });

  it('reads the type and title as text', () => {
    expect(read({ 'System.WorkItemType': 'Bug', 'System.Title': 'Crash' })).toMatchObject({ type: 'Bug', title: 'Crash' });
    expect(read({ 'System.WorkItemType': null, 'System.Title': null })).toMatchObject({ type: '', title: '' });
  });

  it('reads the description format only from an explicit Markdown format', () => {
    const item = (format: unknown) => remoteItem({ id: 1, rev: 1, fields: { 'System.Description': 'Text' }, multilineFieldsFormat: format }, context(), id => id);
    expect(item({ 'System.Description': 'markdown' })).toMatchObject({ description: 'Text', descriptionMarkdown: true });
    expect(item({ 'System.Description': 'HTML' })).toMatchObject({ description: 'Text', descriptionMarkdown: false });
    expect(item('Markdown')).toMatchObject({ description: 'Text', descriptionMarkdown: false });
    expect(item({ 'System.Title': 'Markdown' })).toMatchObject({ description: 'Text', descriptionMarkdown: false });
  });

  it('reads each mapped property, missing ones as null', () => {
    const item = read({ 'Microsoft.VSTS.Common.Risk': '2 - Medium', 'Custom.Other': 'x' }, [], { properties: { risk: 'Microsoft.VSTS.Common.Risk', size: 'Custom.Size' } });
    expect(item.fields).toStrictEqual({ 'Microsoft.VSTS.Common.Risk': '2 - Medium', 'Custom.Size': null });
  });

  it('reads a response that is not an object as an empty item', () => {
    expect(remoteItem('oops', context(), id => `items/${id}`)).toMatchObject({ id: 'undefined', type: '', title: '', tags: [], dependencies: [], fields: {} });
    expect(remoteItem({ id: 5, rev: 1, fields: [], relations: {} }, context(), id => id)).toMatchObject({ id: '5', title: '', parentId: null, dependencies: [] });
  });
});
