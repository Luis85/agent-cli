import { describe, expect, it } from 'vitest';
import { emptyState, lockPath, parseState, pathOfRemote, renameEntries, serializeState, statePath } from '../../src/plugins/backlog/domain/sync-state.ts';

const entry = (id: string) => ({ id, url: `https://dev.azure.com/o/p/_workitems/edit/${id}`, rev: '3', fields: { title: 'abc', state: 'def' } });
const stateText = (items: unknown) => JSON.stringify({ version: 1, connection: 'contoso', items });
const unreadable = {
  code: 'BACKLOG_CONFIG_PROBLEM',
  message: '.forge/sync/contoso.json is not a readable sync state; restore it from version control, or delete it to relink notes by their link property (a relink reports differing fields as conflicts and never overwrites either side).',
  details: { path: '.forge/sync/contoso.json' },
};

describe('the sync state file', () => {
  it('lives in .forge/sync next to the lock of its connection', () => {
    expect(statePath('ado')).toBe('.forge/sync/ado.json');
    expect(lockPath('ado')).toBe('.forge/sync/ado.lock');
    expect(emptyState('ado')).toStrictEqual({ version: 1, connection: 'ado', items: {} });
  });

  it('serializes deterministically, items by path and fields by name', () => {
    const state = { ...emptyState('contoso'), items: { 'b.md': entry('2'), 'a.md': { ...entry('1'), fields: { title: 'x', parent: 'y' } } } };
    const text = serializeState(state);
    expect(text).toBe(`${JSON.stringify({ version: 1, connection: 'contoso', items: { 'a.md': { ...entry('1'), fields: { parent: 'y', title: 'x' } }, 'b.md': { ...entry('2'), fields: { state: 'def', title: 'abc' } } } }, null, 2)}\n`);
    expect(parseState(text, 'contoso')).toStrictEqual(state);
  });

  it('keeps only text field hashes and reads the connection from the caller', () => {
    expect(parseState(stateText({ 'a.md': { ...entry('1'), fields: { title: 'h', order: 5, tags: null } } }), 'other'))
      .toStrictEqual({ version: 1, connection: 'other', items: { 'a.md': { ...entry('1'), fields: { title: 'h' } } } });
  });

  it.each<[string, string]>([
    ['not JSON', 'not json'], ['JSON null', 'null'], ['a list', '[]'], ['version 2', JSON.stringify({ version: 2, items: {} })], ['no items', JSON.stringify({ version: 1 })],
    ['a list of items', JSON.stringify({ version: 1, items: [] })], ['a non-object entry', stateText({ 'a.md': 'x' })],
    ['an empty id', stateText({ 'a.md': { ...entry('1'), id: '' } })], ['a numeric id', stateText({ 'a.md': { ...entry('1'), id: 5 } })],
    ['an empty url', stateText({ 'a.md': { ...entry('1'), url: '' } })], ['a missing url', stateText({ 'a.md': { id: '1', rev: '3', fields: {} } })],
    ['an empty revision', stateText({ 'a.md': { ...entry('1'), rev: '' } })], ['a list revision', stateText({ 'a.md': { ...entry('1'), rev: ['3'] } })],
    ['missing fields', stateText({ 'a.md': { id: '1', url: 'u', rev: '3' } })], ['a list of fields', stateText({ 'a.md': { ...entry('1'), fields: ['h'] } })],
  ])('refuses %s instead of resetting the state', (_, source) => {
    expect(() => parseState(source, 'contoso')).toThrow(expect.objectContaining(unreadable));
  });
});

describe('renamed notes', () => {
  it('follows renamed notes and folders and finds notes by remote id', () => {
    const state = { ...emptyState('contoso'), items: { 'work/A.md': entry('1'), 'work/sub/B.md': entry('2'), 'other/C.md': entry('3'), 'workshop/D.md': entry('4') } };
    expect(renameEntries(state, 'work/A.md', 'work/A2.md', 'file')).toBe(true);
    expect(renameEntries(state, 'work', 'done', 'folder')).toBe(true);
    expect(renameEntries(state, 'missing.md', 'x.md', 'file')).toBe(false);
    expect(renameEntries(state, 'missing', 'x', 'folder')).toBe(false);
    expect(renameEntries(state, 'other/C.md', 'x', 'folder')).toBe(false);
    expect(state.items).toStrictEqual({ 'done/A2.md': entry('1'), 'done/sub/B.md': entry('2'), 'other/C.md': entry('3'), 'workshop/D.md': entry('4') });
    expect(pathOfRemote(state, '2')).toBe('done/sub/B.md');
    expect(pathOfRemote(state, '9')).toBeNull();
  });
});
