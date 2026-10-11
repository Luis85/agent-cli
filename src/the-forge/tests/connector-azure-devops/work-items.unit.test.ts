import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '../../src/plugins/connector-azure-devops/domain/markdown-html.ts';
import { processMapping, unknownFields } from '../../src/plugins/connector-azure-devops/domain/processes.ts';
import { createOperations, relationsLanded, remoteItem, updateOperations } from '../../src/plugins/connector-azure-devops/domain/work-items.ts';

const organization = 'https://dev.azure.com/contoso';
const context = (descriptionFormat: 'markdown' | 'html' = 'markdown', process: 'agile' | 'scrum' = 'agile') => ({ mapping: processMapping(process), descriptionFormat, organization, defaultArea: 'Trailhead\\Default' });

describe('process mappings', () => {
  it('defaults types, states and the effort field per process and merges connection overrides', () => {
    expect(processMapping('agile')).toMatchObject({ types: { PBI: 'User Story', Issue: 'Issue' }, fields: { effort: 'Microsoft.VSTS.Scheduling.StoryPoints', parent: 'System.LinkTypes.Hierarchy-Reverse' } });
    expect(processMapping('scrum')).toMatchObject({ types: { PBI: 'Product Backlog Item', Issue: 'Impediment' }, states: { 'Task:Active': 'In Progress' }, fields: { effort: 'Microsoft.VSTS.Scheduling.Effort' } });
    expect(processMapping('basic').types).toEqual({ Epic: 'Epic', Feature: 'Epic', PBI: 'Issue', Issue: 'Issue', Bug: 'Issue', Task: 'Task' });
    expect(processMapping('custom')).toMatchObject({ types: {}, states: {} });
    const custom = processMapping('agile', { types: { PBI: 'Requirement' }, states: { Review: 'Resolved' }, fields: { effort: 'Custom.Size', description: '' }, properties: { risk: 'Microsoft.VSTS.Common.Risk' } });
    expect(custom).toMatchObject({ types: { PBI: 'Requirement', Epic: 'Epic' }, states: { Review: 'Resolved' }, fields: { effort: 'Custom.Size', description: null }, properties: { risk: 'Microsoft.VSTS.Common.Risk' } });
    expect(unknownFields({ fields: { effort: 'x', storyPoints: 'y' } })).toEqual(['storyPoints']);
  });
});

describe('JSON Patch documents', () => {
  it('creates a work item with its fields, Markdown description format, area and parent link', () => {
    expect(createOperations({ type: 'User Story', title: 'Draft', state: 'New', parentId: '7', priority: 1, effort: 3, tags: ['a', 'b'], description: '**Plan**', area: 'Trailhead\\Web', iteration: 'Trailhead\\Sprint 1', fields: { 'Microsoft.VSTS.Common.Risk': '2 - Medium' } }, context())).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'Draft' },
      { op: 'add', path: '/fields/System.State', value: 'New' },
      { op: 'add', path: '/fields/System.IterationPath', value: 'Trailhead\\Sprint 1' },
      { op: 'add', path: '/fields/System.AreaPath', value: 'Trailhead\\Web' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 1 },
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: 3 },
      { op: 'add', path: '/fields/System.Tags', value: 'a; b' },
      { op: 'add', path: '/fields/System.Description', value: '**Plan**' },
      { op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Risk', value: '2 - Medium' },
      { op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${organization}/_apis/wit/workItems/7` } },
    ]);
    expect(createOperations({ type: 'Task', title: 'T', description: '# Head' }, context('html'))).toContainEqual({ op: 'add', path: '/fields/System.Description', value: '<h1>Head</h1>' });
    const unsyncedArea = { ...context(), mapping: processMapping('agile', { fields: { area: '' } }) };
    expect(createOperations({ type: 'Task', title: 'T', area: 'Trailhead\\Web' }, unsyncedArea)).toContainEqual({ op: 'add', path: '/fields/System.AreaPath', value: 'Trailhead\\Web' });
  });

  it('guards an update with a test of the revision, clears null fields and swaps the parent relation by index', () => {
    const relations = [{ rel: 'System.LinkTypes.Related', url: 'x' }, { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${organization}/_apis/wit/workItems/1` }];
    expect(updateOperations({ state: 'Active', priority: null, parentId: '9' }, '4', context(), relations)).toEqual([
      { op: 'test', path: '/rev', value: 4 },
      { op: 'add', path: '/fields/System.State', value: 'Active' },
      { op: 'remove', path: '/fields/Microsoft.VSTS.Common.Priority' },
      { op: 'remove', path: '/relations/1' },
      { op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${organization}/_apis/wit/workItems/9` } },
    ]);
    expect(updateOperations({ parentId: null }, '2', context(), [])).toEqual([{ op: 'test', path: '/rev', value: 2 }]);
  });

  it('makes the predecessor relations exactly the given set, removing by index in descending order before adding', () => {
    const link = (rel: string, id: number) => ({ rel, url: `${organization}/_apis/wit/workItems/${id}` });
    const relations = [link('System.LinkTypes.Dependency-Reverse', 4), link('System.LinkTypes.Hierarchy-Reverse', 1), link('System.LinkTypes.Dependency-Forward', 6), link('System.LinkTypes.Dependency-Reverse', 5), link('System.LinkTypes.Dependency-Reverse', 7)];
    expect(updateOperations({ dependencies: ['5', '8', '8'], parentId: '2' }, '3', context(), relations)).toEqual([
      { op: 'test', path: '/rev', value: 3 },
      { op: 'remove', path: '/relations/4' },
      { op: 'remove', path: '/relations/1' },
      { op: 'remove', path: '/relations/0' },
      { op: 'add', path: '/relations/-', value: link('System.LinkTypes.Hierarchy-Reverse', 2) },
      { op: 'add', path: '/relations/-', value: link('System.LinkTypes.Dependency-Reverse', 8) },
    ]);
    expect(createOperations({ type: 'Task', title: 'Pack', dependencies: ['4', '9'] }, context())).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'Pack' },
      { op: 'add', path: '/relations/-', value: link('System.LinkTypes.Dependency-Reverse', 4) },
      { op: 'add', path: '/relations/-', value: link('System.LinkTypes.Dependency-Reverse', 9) },
    ]);
    const unmapped = { ...context(), mapping: processMapping('agile', { fields: { dependencies: '' } }) };
    expect(updateOperations({ dependencies: [] }, '3', unmapped, relations)).toEqual([{ op: 'test', path: '/rev', value: 3 }]);
    expect(remoteItem({ id: 1, rev: 1, fields: {}, relations }, unmapped, id => id)).not.toHaveProperty('dependencies');
  });

  it('confirms link changes only when the returned relations are the read ones minus the removed plus the added', () => {
    const link = (rel: string, id: number) => ({ rel, url: `${organization}/_apis/wit/workItems/${id}` });
    const [related, predecessor, parent] = [link('System.LinkTypes.Related', 9), link('System.LinkTypes.Dependency-Reverse', 4), link('System.LinkTypes.Hierarchy-Reverse', 1)];
    const read = [related, predecessor, parent];
    const operations = updateOperations({ dependencies: ['5'] }, '3', context(), read);
    const added = link('System.LinkTypes.Dependency-Reverse', 5);
    expect(relationsLanded(read, operations, [related, parent, added])).toBe(true);
    // A relation added on the other end meanwhile does not matter.
    expect(relationsLanded(read, operations, [related, parent, added, link('System.LinkTypes.Related', 12)])).toBe(true);
    // The Related link was removed on the other end before the PATCH: index 1 then named the parent.
    expect(relationsLanded(read, operations, [predecessor, added])).toBe(false);
    // The predecessor was removed on the other end, so the removal by index hit the parent although the predecessor is gone.
    expect(relationsLanded(read, operations, [related, added])).toBe(false);
    expect(relationsLanded(read, operations, [related, parent])).toBe(false);
    expect(relationsLanded(read, updateOperations({ title: 'Only a field' }, '3', context(), read), read)).toBe(true);
  });

  it('ignores links removed on the other end that no removal by position could have hit', () => {
    const link = (rel: string, id: number) => ({ rel, url: `${organization}/_apis/wit/workItems/${id}` });
    const [predecessor, related, parent] = [link('System.LinkTypes.Dependency-Reverse', 4), link('System.LinkTypes.Related', 9), link('System.LinkTypes.Hierarchy-Reverse', 1)];
    const added = link('System.LinkTypes.Dependency-Reverse', 5);
    // An update that removes nothing: the Related link and the parent went meanwhile, the addition landed.
    const adding = updateOperations({ dependencies: ['4', '5'] }, '3', context(), [predecessor, related, parent]);
    expect(adding.some(operation => operation.op === 'remove')).toBe(false);
    expect(relationsLanded([predecessor, related, parent], adding, [predecessor, added])).toBe(true);
    // One removal at index 0 can only have hit index 0 or 1, so the parent at index 2 may go meanwhile.
    const removing = updateOperations({ dependencies: ['5'] }, '3', context(), [predecessor, related, parent]);
    expect(relationsLanded([predecessor, related, parent], removing, [related, added])).toBe(true);
    expect(relationsLanded([predecessor, related, parent], removing, [related, parent, added, link('System.LinkTypes.Related', 12)])).toBe(true);
    // Still wrong: the removed link must be gone, and the next link stays, or the removal may have hit it.
    expect(relationsLanded([predecessor, related, parent], removing, [predecessor, parent, added])).toBe(false);
    expect(relationsLanded([predecessor, related, parent], removing, [parent, added])).toBe(false);
    expect(relationsLanded([predecessor, related, parent], removing, [added])).toBe(false);
    // Two removals up to index 1 reach up to index 3.
    const [other, tail] = [link('System.LinkTypes.Dependency-Reverse', 6), link('System.LinkTypes.Related', 12)];
    const both = updateOperations({ dependencies: ['5'] }, '3', context(), [predecessor, other, related, parent, tail]);
    expect(relationsLanded([predecessor, other, related, parent, tail], both, [related, parent, added])).toBe(true);
    expect(relationsLanded([predecessor, other, related, parent, tail], both, [related, tail, added])).toBe(false);
  });
});

describe('reading work items', () => {
  const json = (formats?: Record<string, string>) => ({
    id: 12, rev: 5,
    fields: { 'System.WorkItemType': 'User Story', 'System.Title': 'Draft', 'System.State': 'Active', 'System.IterationPath': 'Trailhead\\Sprint 1', 'System.AreaPath': 'Trailhead', 'Microsoft.VSTS.Common.Priority': 2, 'Microsoft.VSTS.Scheduling.StoryPoints': 5, 'System.Tags': 'web; ux', 'System.Description': '<p>Html</p>' },
    relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${organization}/_apis/wit/workItems/3` }, { rel: 'System.LinkTypes.Dependency-Reverse', url: `${organization}/_apis/wit/workItems/8` }],
    ...(formats ? { multilineFieldsFormat: formats } : {}),
  });

  it('maps fields, parent and predecessor links into a neutral item with the raw description and its declared format', () => {
    const item = remoteItem(json(), context(), id => `link/${id}`);
    expect(item).toEqual({
      id: '12', rev: '5', url: 'link/12', type: 'User Story', title: 'Draft', state: 'Active', parentId: '3', iteration: 'Trailhead\\Sprint 1', area: 'Trailhead',
      priority: 2, effort: 5, tags: ['web', 'ux'], description: '<p>Html</p>', descriptionMarkdown: false, dependencies: ['8'], fields: {},
    });
    expect(remoteItem(json({ 'System.Description': 'Markdown' }), context(), id => id)).toMatchObject({ description: '<p>Html</p>', descriptionMarkdown: true });
    const unmapped = { ...context(), mapping: processMapping('agile', { fields: { description: '' } }) };
    expect(remoteItem(json(), unmapped, id => id)).not.toHaveProperty('description');
  });
});

describe('Markdown to HTML', () => {
  it('converts common Markdown and escapes everything else', () => {
    expect(markdownToHtml('# Plan\n\nSome **bold** and *em* with `a<b>` and [docs](https://example.com).\nNext line\n\n- one\n- [[Note|two]]\n\n1. first\n\n> quote\n\n```\n<script>\n```'))
      .toBe('<h1>Plan</h1><p>Some <strong>bold</strong> and <em>em</em> with <code>a&lt;b&gt;</code> and <a href="https://example.com">docs</a>.<br>Next line</p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><blockquote>quote</blockquote><pre><code>&lt;script&gt;</code></pre>');
    expect(markdownToHtml('<img src=x onerror=alert(1)> [x](javascript:alert(1))')).toBe('<p>&lt;img src=x onerror=alert(1)&gt; x)</p>');
  });
});
