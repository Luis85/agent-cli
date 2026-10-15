import { describe, expect, it } from 'vitest';
import { processMapping, type MappingOverrides } from '../../src/plugins/connector-azure-devops/domain/processes.ts';
import { createOperations, updateOperations, type DescriptionFormat, type PatchContext } from '../../src/plugins/connector-azure-devops/domain/work-items.ts';

const organization = 'https://dev.azure.com/contoso';
const context = (overrides: MappingOverrides = {}, descriptionFormat: DescriptionFormat = 'markdown'): PatchContext => ({ mapping: processMapping('agile', overrides), descriptionFormat, organization, defaultArea: 'Trailhead\\Default' });
const link = (rel: string, url: string) => ({ op: 'add', path: '/relations/-', value: { rel, url } });
const PARENT = 'System.LinkTypes.Hierarchy-Reverse', PREDECESSOR = 'System.LinkTypes.Dependency-Reverse';
const revision = { op: 'test', path: '/rev', value: 7 };
/** Every neutral field and link left unsynced by an empty override. */
const unsynced = { fields: { type: '', title: '', state: '', iteration: '', area: '', priority: '', effort: '', tags: '', description: '', parent: '', dependencies: '' } };

describe('field operations of an update', () => {
  it('sets the work item type and every other mapped field', () => {
    expect(updateOperations({ type: 'Bug', title: 'T', state: 'Active', iteration: 'I', area: 'A', priority: 2, effort: 5, tags: ['a', 'b'] }, '7', context())).toStrictEqual([
      revision,
      { op: 'add', path: '/fields/System.WorkItemType', value: 'Bug' },
      { op: 'add', path: '/fields/System.Title', value: 'T' },
      { op: 'add', path: '/fields/System.State', value: 'Active' },
      { op: 'add', path: '/fields/System.IterationPath', value: 'I' },
      { op: 'add', path: '/fields/System.AreaPath', value: 'A' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 2 },
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: 5 },
      { op: 'add', path: '/fields/System.Tags', value: 'a; b' },
    ]);
  });

  it('writes nothing for fields and links that do not sync', () => {
    const patch = { type: 'Bug', title: 'T', state: 'Active', iteration: 'I', area: 'A', priority: 2, effort: 5, tags: ['a'], description: 'd', parentId: '9', dependencies: ['5'] };
    const relations = [{ rel: PARENT, url: `${organization}/_apis/wit/workItems/1` }, { rel: PREDECESSOR, url: `${organization}/_apis/wit/workItems/4` }];
    expect(updateOperations(patch, '7', context(unsynced), relations)).toStrictEqual([revision]);
    expect(createOperations({ ...patch, area: undefined }, context(unsynced))).toStrictEqual([]);
  });

  it('clears a description without declaring its format', () => {
    expect(updateOperations({ description: null }, '7', context())).toStrictEqual([revision, { op: 'remove', path: '/fields/System.Description' }]);
  });

  it('writes an HTML description without the Markdown format and a Markdown one with it', () => {
    expect(updateOperations({ description: '# Head' }, '7', context({}, 'html'))).toStrictEqual([revision, { op: 'add', path: '/fields/System.Description', value: '<h1>Head</h1>' }]);
    expect(updateOperations({ description: '# Head' }, '7', context())).toStrictEqual([
      revision, { op: 'add', path: '/fields/System.Description', value: '# Head' }, { op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
    ]);
  });

  it('writes and clears extra mapped fields', () => {
    expect(updateOperations({ fields: { 'Microsoft.VSTS.Common.Risk': '1 - High', 'Custom.Size': null } }, '7', context())).toStrictEqual([
      revision, { op: 'add', path: '/fields/Microsoft.VSTS.Common.Risk', value: '1 - High' }, { op: 'remove', path: '/fields/Custom.Size' },
    ]);
  });
});

describe('field operations of a new work item', () => {
  it('leaves out null, missing and empty values, but keeps zero and empty text', () => {
    const draft = { type: 'Task', title: 'T', state: null, iteration: undefined, priority: null, effort: 0, tags: [], description: '', fields: { 'Custom.Gone': null, 'Custom.Kept': 0 } };
    expect(createOperations(draft, context())).toStrictEqual([
      { op: 'add', path: '/fields/System.Title', value: 'T' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: 0 },
      { op: 'add', path: '/fields/System.Description', value: '' },
      { op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
      { op: 'add', path: '/fields/Custom.Kept', value: 0 },
    ]);
  });

  it('links a parent and each predecessor once with multi-digit ids', () => {
    expect(createOperations({ type: 'Task', title: 'T', parentId: '1234', dependencies: ['56', '56', '7'] }, context())).toStrictEqual([
      { op: 'add', path: '/fields/System.Title', value: 'T' },
      link(PARENT, `${organization}/_apis/wit/workItems/1234`),
      link(PREDECESSOR, `${organization}/_apis/wit/workItems/56`),
      link(PREDECESSOR, `${organization}/_apis/wit/workItems/7`),
    ]);
  });

  it('files the area under System.AreaPath only when area does not sync', () => {
    expect(createOperations({ type: 'Task', title: 'T', area: 'Trailhead\\Web' }, context({ fields: { area: 'Custom.Area' } }))).toStrictEqual([
      { op: 'add', path: '/fields/System.Title', value: 'T' }, { op: 'add', path: '/fields/Custom.Area', value: 'Trailhead\\Web' },
    ]);
    expect(createOperations({ type: 'Task', title: 'T', area: null }, context({ fields: { area: '' } }))).toStrictEqual([{ op: 'add', path: '/fields/System.Title', value: 'T' }]);
  });
});

describe('link operations of an update', () => {
  it('reads multi-digit ids at the end of relation URLs only', () => {
    const relations = [
      { rel: PREDECESSOR, url: `${organization}/_apis/wit/workItems/12` },
      { rel: PREDECESSOR, url: 'https://srv/tfs/2019/_apis/wit/workItems/7' },
      { rel: PREDECESSOR, url: 'https://srv/tfs/_apis/wit/workItems/2019x' },
    ];
    expect(updateOperations({ dependencies: ['12', '7', '2019'] }, '7', context(), relations)).toStrictEqual([
      revision, { op: 'remove', path: '/relations/2' }, link(PREDECESSOR, `${organization}/_apis/wit/workItems/2019`),
    ]);
  });

  it('removes the parent link without adding one when the parent is cleared, and ignores links that are not records', () => {
    const relations = [null, 'x', { rel: 'System.LinkTypes.Related', url: `${organization}/_apis/wit/workItems/3` }, { rel: PARENT, url: `${organization}/_apis/wit/workItems/3` }];
    expect(updateOperations({ parentId: null }, '7', context(), relations)).toStrictEqual([revision, { op: 'remove', path: '/relations/3' }]);
    expect(updateOperations({ parentId: '3' }, '7', context(), [])).toStrictEqual([revision, link(PARENT, `${organization}/_apis/wit/workItems/3`)]);
  });
});
