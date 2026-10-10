import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '../../src/plugins/connector-azure-devops/domain/markdown-html.ts';
import { processMapping, unknownFields } from '../../src/plugins/connector-azure-devops/domain/processes.ts';
import { createOperations, remoteItem, updateOperations } from '../../src/plugins/connector-azure-devops/domain/work-items.ts';

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
      priority: 2, effort: 5, tags: ['web', 'ux'], description: '<p>Html</p>', descriptionMarkdown: false, links: { predecessors: ['8'] }, fields: {},
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
