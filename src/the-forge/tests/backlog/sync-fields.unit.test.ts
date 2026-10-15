import { describe, expect, it } from 'vitest';
import {
  canonical, decide, decideDescription, iterationName, iterationPath, localState, localType, priorityLabel, priorityNumber, remoteState, remoteType, sortedIds,
  type NameMappings,
} from '../../src/plugins/backlog/domain/sync-fields.ts';
import { comments, noteBody, withBody, withoutComments } from '../../src/plugins/backlog/domain/notes.ts';
import { processMapping } from '../../src/plugins/connector-azure-devops/domain/processes.ts';

describe('the three-way field decision', () => {
  it('syncs a field changed on one side, reports one changed on both sides, and keeps agreement quiet', () => {
    expect(decide('b', 'b', 'b')).toBe('unchanged');
    expect(decide('b', 'l', 'b')).toBe('push');
    expect(decide('b', 'b', 'r')).toBe('pull');
    expect(decide('b', 'l', 'r')).toBe('conflict');
    expect(decide('b', 'x', 'x')).toBe('converged');
  });

  it('never overwrites without a base, or over a side that cannot express the field', () => {
    expect(decide(undefined, 'a', 'a')).toBe('converged');
    expect(decide(undefined, 'a', 'b')).toBe('conflict');
    expect(decide(undefined, 'a', undefined)).toBe('skip');
    expect(decide(undefined, undefined, 'r')).toBe('skip');
    expect(decide('b', undefined, 'r')).toBe('skip');
    expect(decide('b', 'l', undefined)).toBe('skip');
    expect(decide('b', undefined, 'b')).toBe('unchanged');
    expect(decide('b', 'b', undefined)).toBe('unchanged');
    expect(decide(undefined, undefined, undefined)).toBe('unchanged');
  });

  it('compares descriptions per side, pulls only Markdown and conflicts on a first sync with different texts', () => {
    const sides = (local: string, remote: string, localBase?: string, remoteBase?: string, markdown = false) => ({ local, remote, localBase, remoteBase, same: local === remote, markdown });
    expect(decideDescription(sides('md', '<p>html</p>'))).toBe('conflict');
    expect(decideDescription(sides('md', 'md'))).toBe('converged');
    expect(decideDescription(sides('md', '<p>md</p>', 'md', '<p>md</p>'))).toBe('unchanged');
    expect(decideDescription(sides('md2', '<p>md</p>', 'md', '<p>md</p>'))).toBe('push');
    expect(decideDescription(sides('md', '<p>new</p>', 'md', '<p>md</p>'))).toBe('skip');
    expect(decideDescription(sides('md', 'new', 'md', 'md', true))).toBe('pull');
    expect(decideDescription(sides('md2', 'new', 'md', 'md', true))).toBe('conflict');
    expect(decideDescription(sides('same', 'same', 'md', 'md'))).toBe('converged');
    expect(decideDescription({ ...sides('md', 'x', 'md', 'x'), local: undefined })).toBe('skip');
  });

  it('compares canonical values: sanitized titles, case-insensitive sorted tags, trimmed text and normalized newlines', () => {
    expect(canonical('title', 'A/B: plan')).toBe(canonical('title', 'A-B- plan'));
    expect(canonical('tags', ['Beta', 'alpha', 'beta'])).toBe(canonical('tags', ['ALPHA', 'beta']));
    expect(canonical('description', 'Line\r\nTwo\n')).toBe(canonical('description', 'Line\nTwo'));
    expect(canonical('dependencies', ['10', '9', '9', 'new:a.md'])).toBe('["9","10","new:a.md"]');
    expect(canonical('state', ' Active ')).toBe(canonical('state', 'Active'));
    expect(canonical('priority', null)).toBe('null');
    expect(canonical('priority', 2)).not.toBe(canonical('priority', '2'));
  });
});

describe('name mappings', () => {
  // Mappings resolve inside each test, so a mutant is active while they are read.
  const agile = () => processMapping('agile');
  const scrum = () => processMapping('scrum');

  it('maps backlog types to process work item types and back to the first local type', () => {
    expect(remoteType(agile(), 'pbi')).toBe('User Story');
    expect(remoteType(scrum(), 'PBI')).toBe('Product Backlog Item');
    expect(remoteType(agile(), 'Milestone')).toBeUndefined();
    expect(localType(agile(), 'User Story', null)).toBe('PBI');
    expect(localType(processMapping('basic'), 'Issue', 'Bug')).toBe('Bug');
    expect(localType(processMapping('basic'), 'Issue', null)).toBe('PBI');
    expect(localType(agile(), 'Risk', 'PBI')).toBeUndefined();
  });

  it('maps states with Type:State entries first and reads them back in the view\'s declared vocabulary', () => {
    expect(remoteState(agile(), 'PBI', 'Done')).toBe('Closed');
    expect(remoteState(scrum(), 'PBI', 'Active')).toBe('Committed');
    expect(remoteState(scrum(), 'Task', 'Active')).toBe('In Progress');
    expect(remoteState(agile(), 'PBI', 'Blocked')).toBe('Blocked');
    expect(localState(agile(), 'PBI', 'Closed', null, [])).toBe('Closed');
    expect(localState(agile(), 'PBI', 'Closed', null, ['Open', 'Active', 'Done'])).toBe('Done');
    expect(localState(agile(), 'PBI', 'New', null, ['Open', 'Active', 'Done'])).toBe('Open');
    expect(localState(agile(), 'PBI', 'Active', 'In Progress', [])).toBe('In Progress');
    expect(localState(scrum(), 'Task', 'In Progress', null, [])).toBe('In Progress');
  });

  it('maps priority labels by their leading number and iteration paths under the iteration root', () => {
    expect(priorityNumber('2 - Should')).toBe(2);
    expect(priorityNumber('High')).toBeNull();
    expect(priorityLabel(1, ['1 - Must', '2 - Should'])).toBe('1 - Must');
    expect(priorityLabel(4, ['1 - Must'])).toBe('4');
    expect(iterationName('Trailhead', 'Trailhead\\Sprints\\Sprint 2')).toBe('Sprint 2');
    expect(iterationName('Trailhead', 'Trailhead')).toBeNull();
    expect(iterationName('Trailhead', 'Other\\Sprint 1')).toBeNull();
  });
});

describe('note bodies', () => {
  it('finds and strips Obsidian comments outside fenced code', () => {
    const body = 'Plan %%private%% it.\n\n%%\nblock\n%%\n\n```\n%%kept%%\n```\nEnd';
    expect(withoutComments(body)).toBe('Plan  it.\n\n\n\n```\n%%kept%%\n```\nEnd');
    expect(comments(body)).toEqual(['%%private%%', '%%\nblock\n%%']);
  });

  it('reads and replaces the text after the frontmatter, keeping the frontmatter bytes', () => {
    const text = '---\ntype: "PBI"\n---\n\nOld body\n';
    expect(noteBody(text)).toBe('Old body\n');
    expect(withBody(text, 'New **body**\r\n')).toBe('---\ntype: "PBI"\n---\nNew **body**\n');
    expect(withBody(text, '')).toBe('---\ntype: "PBI"\n---\n');
    expect(withBody('---\ntype: "PBI"\n---\n', 'Text')).toBe('---\ntype: "PBI"\n---\nText\n');
  });
});

describe('canonical field texts', () => {
  it.each<[string, unknown, string]>([
    ['tags', ['Beta', 'alpha', 'beta'], '["alpha","beta"]'], ['tags', [' a', '', ' '], '["a"]'], ['tags', ['b'], '["b"]'],
    ['dependencies', ['100', '20', '12a', 'new:b', 'new:a', '20'], '["20","100","12a","new:a","new:b"]'],
    ['description', ' a\r\nb\rc\n', '"a\\nb\\nc"'], ['description', 5, '5'], ['title', 5, '5'], ['title', ' A/B ', '"A-B"'],
    ['state', ' a/b ', '"a/b"'], ['property:notes', 'a\r\nb', '"a\\r\\nb"'], ['property:list', ['b', 'a'], '["b","a"]'], ['property:tags', ['B'], '["B"]'],
    ['priority', 2, '2'], ['blocked', true, 'true'], ['priority', null, 'null'], ['priority', undefined, 'null'],
  ])('canonical(%s, %j) is %s', (field, value, expected) => {
    expect(canonical(field, value as never)).toBe(expected);
  });

  it('orders remote ids numerically, then other ids by text', () => {
    expect(sortedIds(['100', '20', '3', '12a', 'new:12', 'new:b', 'new:a', '20'])).toStrictEqual(['3', '20', '100', '12a', 'new:12', 'new:a', 'new:b']);
    expect(sortedIds(['x1', '1x', '2'])).toStrictEqual(['2', '1x', 'x1']);
  });
});

describe('description decisions', () => {
  const sides = (local: string | undefined, remote: string | undefined, localBase?: string, remoteBase?: string, markdown = false) => ({ local, remote, localBase, remoteBase, same: local === remote, markdown });

  it.each<[string, ReturnType<typeof sides>, string]>([
    ['no text on either side', sides(undefined, undefined), 'unchanged'], ['no remote text', sides('md', undefined, 'md', 'md'), 'skip'],
    ['no local text', sides(undefined, 'md', 'md', 'md'), 'skip'], ['no remote base', sides('a', 'b', 'a', undefined), 'conflict'],
    ['no local base', sides('a', 'b', undefined, 'b'), 'conflict'], ['one base and equal texts', sides('a', 'a', 'a', undefined), 'converged'],
    ['equal texts unchanged', sides('x', 'x', 'x', 'x'), 'unchanged'], ['equal texts changed locally', sides('y', 'y', 'x', 'y'), 'converged'],
    ['equal texts changed remotely', sides('y', 'y', 'y', 'x'), 'converged'], ['a local change over Markdown', sides('new', 'md', 'md', 'md', true), 'push'],
    ['a remote Markdown change', sides('md', 'new', 'md', 'md', true), 'pull'], ['a remote HTML change', sides('md', '<p>new</p>', 'md', '<p>md</p>'), 'skip'],
  ])('decides %s', (_, input, expected) => {
    expect(decideDescription(input)).toBe(expected);
  });
});

describe('custom name mappings', () => {
  const mapping = (): NameMappings => ({
    types: { PBI: 'Story', Bug: 'Defect', Issue: 'Defect' },
    states: { 'Task:Active': 'Doing', 'PBI:Done': 'Resolved', Active: 'Committed', Done: 'Closed', Finished: 'Closed' },
  });

  it('maps types case-insensitively, keeping a current type that maps to the remote one', () => {
    expect(remoteType(mapping(), 'bug')).toBe('Defect');
    expect(localType(mapping(), 'defect', 'Issue')).toBe('Issue');
    expect(localType(mapping(), 'Defect', 'PBI')).toBe('Bug');
    expect(localType(mapping(), 'Defect', null)).toBe('Bug');
  });

  it('maps states with qualified entries of the type first, plain entries for every type', () => {
    expect(remoteState(mapping(), null, 'active')).toBe('Committed');
    expect(remoteState(mapping(), 'task', 'Active')).toBe('Doing');
    expect(remoteState(mapping(), 'PBI', 'Done')).toBe('Resolved');
    expect(remoteState(mapping(), 'Bug', 'Done')).toBe('Closed');
    expect(remoteState(mapping(), 'Bug', 'Parked')).toBe('Parked');
  });

  it('reads remote states back, never through another type\'s qualified entry', () => {
    expect(localState(mapping(), null, 'Committed', null, [])).toBe('Active');
    expect(localState(mapping(), 'PBI', 'Doing', null, [])).toBe('Doing');
    expect(localState(mapping(), 'Task', 'doing', null, [])).toBe('Active');
    expect(localState(mapping(), 'PBI', 'Closed', 'Active', [])).toBe('Done');
    expect(localState(mapping(), 'Bug', 'Closed', 'finished', [])).toBe('finished');
    expect(localState(mapping(), 'Bug', 'Closed', null, ['Open', 'Finished'])).toBe('Finished');
  });

  it('spells an unmapped remote state as declared, else as the remote names it', () => {
    const none = (): NameMappings => ({ types: {}, states: {} });
    expect(localState(none(), 'PBI', 'done', null, ['Open', 'Done'])).toBe('Done');
    expect(localState(none(), 'PBI', 'done', null, ['Open'])).toBe('done');
    expect(localState(none(), 'PBI', 'done', null, [])).toBe('done');
  });

  it('reads priority numbers only at the start of a label', () => {
    expect([priorityNumber('P1'), priorityNumber(' 2 - x'), priorityNumber('10 - Ten'), priorityNumber('x 2'), priorityNumber(null)]).toStrictEqual([null, 2, 10, null, null]);
    expect(priorityLabel(10, ['1 - Must', '10 - Ten'])).toBe('10 - Ten');
  });

  it('builds and reads iteration paths under the root, case-insensitively', () => {
    expect(iterationPath('Root', 'Sprint 1')).toBe('Root\\Sprint 1');
    expect(iterationName('Root', null)).toBeNull();
    expect(iterationName('Root', 'root\\Sprint 2')).toBe('Sprint 2');
    expect(iterationName('Root', 'Root\\')).toBeNull();
    expect(iterationName('Root', 'RootX\\Sprint 2')).toBeNull();
  });
});
