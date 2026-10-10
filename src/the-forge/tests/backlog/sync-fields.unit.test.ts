import { describe, expect, it } from 'vitest';
import {
  canonical, decide, decideDescription, iterationName, localState, localType, priorityLabel, priorityNumber, remoteState, remoteType,
} from '../../src/plugins/backlog/domain/sync-fields.ts';
import { emptyState, parseState, pathOfRemote, renameEntries, serializeState } from '../../src/plugins/backlog/domain/sync-state.ts';
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
    expect(canonical('state', ' Active ')).toBe(canonical('state', 'Active'));
    expect(canonical('priority', null)).toBe('null');
    expect(canonical('priority', 2)).not.toBe(canonical('priority', '2'));
  });
});

describe('name mappings', () => {
  const agile = processMapping('agile');
  const scrum = processMapping('scrum');

  it('maps backlog types to process work item types and back to the first local type', () => {
    expect(remoteType(agile, 'pbi')).toBe('User Story');
    expect(remoteType(scrum, 'PBI')).toBe('Product Backlog Item');
    expect(remoteType(agile, 'Milestone')).toBeUndefined();
    expect(localType(agile, 'User Story', null)).toBe('PBI');
    expect(localType(processMapping('basic'), 'Issue', 'Bug')).toBe('Bug');
    expect(localType(processMapping('basic'), 'Issue', null)).toBe('PBI');
    expect(localType(agile, 'Risk', 'PBI')).toBeUndefined();
  });

  it('maps states with Type:State entries first and reads them back in the view\'s declared vocabulary', () => {
    expect(remoteState(agile, 'PBI', 'Done')).toBe('Closed');
    expect(remoteState(scrum, 'PBI', 'Active')).toBe('Committed');
    expect(remoteState(scrum, 'Task', 'Active')).toBe('In Progress');
    expect(remoteState(agile, 'PBI', 'Blocked')).toBe('Blocked');
    expect(localState(agile, 'PBI', 'Closed', null, [])).toBe('Closed');
    expect(localState(agile, 'PBI', 'Closed', null, ['Open', 'Active', 'Done'])).toBe('Done');
    expect(localState(agile, 'PBI', 'New', null, ['Open', 'Active', 'Done'])).toBe('Open');
    expect(localState(agile, 'PBI', 'Active', 'In Progress', [])).toBe('In Progress');
    expect(localState(scrum, 'Task', 'In Progress', null, [])).toBe('In Progress');
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

describe('the sync state file', () => {
  const entry = (id: string) => ({ id, url: `https://dev.azure.com/o/p/_workitems/edit/${id}`, rev: '3', fields: { title: 'abc', state: 'def' } });

  it('serializes deterministically and refuses unreadable files instead of resetting them', () => {
    const state = { ...emptyState('contoso'), items: { 'b.md': entry('2'), 'a.md': { ...entry('1'), fields: { title: 'x', parent: 'y' } } } };
    const text = serializeState(state);
    expect(Object.keys(JSON.parse(text).items)).toEqual(['a.md', 'b.md']);
    expect(Object.keys(JSON.parse(text).items['a.md'].fields)).toEqual(['parent', 'title']);
    expect(parseState(text, 'contoso')).toEqual(state);
    expect(() => parseState('{"version":2}', 'contoso')).toThrow(expect.objectContaining({ code: 'BACKLOG_CONFIG_PROBLEM', details: { path: '.forge/sync/contoso.json' } }));
    expect(() => parseState('not json', 'contoso')).toThrow(expect.objectContaining({ code: 'BACKLOG_CONFIG_PROBLEM' }));
  });

  it('follows renamed notes and folders and finds notes by remote id', () => {
    const state = { ...emptyState('contoso'), items: { 'work/A.md': entry('1'), 'work/sub/B.md': entry('2'), 'other/C.md': entry('3') } };
    expect(renameEntries(state, 'work/A.md', 'work/A2.md', 'file')).toBe(true);
    expect(renameEntries(state, 'work', 'done', 'folder')).toBe(true);
    expect(renameEntries(state, 'missing.md', 'x.md', 'file')).toBe(false);
    expect(Object.keys(state.items).sort()).toEqual(['done/A2.md', 'done/sub/B.md', 'other/C.md']);
    expect(pathOfRemote(state, '2')).toBe('done/sub/B.md');
    expect(pathOfRemote(state, '9')).toBeNull();
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
