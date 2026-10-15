import { describe, expect, it } from 'vitest';
import type { NoteSource } from '../../src/plugins/backlog/domain/items.ts';
import { buildModel } from '../../src/plugins/backlog/domain/model.ts';
import { observedStates, requirementsBoard } from '../../src/plugins/backlog/domain/board.ts';
import { resolveSettings, type ViewOptions } from '../../src/plugins/backlog/domain/settings-resolve.ts';

type Notes = Record<string, Record<string, unknown>>;
function vault(notes: Notes): NoteSource {
  return {
    frontmatter: path => notes[path],
    frontmatterLinks: path => Object.entries(notes[path] ?? {}).flatMap(([key, value]) => (typeof value === 'string' && /^\[\[.+\]\]$/.test(value) ? [{ key, link: value.slice(2, -2) }] : [])),
    resolve: linkpath => (`${linkpath}.md` in notes ? `${linkpath}.md` : null),
  };
}
const settingsFor = (options: ViewOptions) => resolveSettings({ stateProperty: 'note.status', ...options });
const model = (notes: Notes, options: ViewOptions = {}, results = Object.keys(notes)) => buildModel(vault(notes), results, settingsFor(options), path => path in notes);
const board = (notes: Notes, options: ViewOptions = {}, results = Object.keys(notes)) =>
  requirementsBoard(model(notes, options, results), settingsFor(options)).map(({ cards, ...column }) => ({ ...column, cards: cards.map(card => card.title) }));

describe('observed states', () => {
  it('keeps the first spelling of each result state, open states first, each group in locale order', () => {
    const notes = { 'a.md': { type: 'PBI', status: 'review' }, 'b.md': { type: 'PBI', status: 'Done' }, 'c.md': { type: 'PBI', status: 'Review' }, 'd.md': { type: 'PBI', status: 'closed' }, 'e.md': { type: 'PBI', status: 'Open' }, 'f.md': { type: 'PBI' } };
    expect(observedStates(model(notes).items, settingsFor({ doneValues: 'Done, Closed' }))).toStrictEqual(['Open', 'review', 'closed', 'Done']);
  });

  it('ignores context rows', () => {
    const notes = { 'Ctx.md': { type: 'Epic', status: 'Parked' }, 'a.md': { type: 'PBI', parent: '[[Ctx]]', status: 'Open' } };
    expect(observedStates(model(notes, {}, ['a.md']).items, settingsFor({}))).toStrictEqual(['Open']);
  });
});

describe('the requirements board', () => {
  it('builds a no-state column, the configured columns with limits, policies and done flags, then stray states', () => {
    const notes = {
      'a.md': { type: 'PBI', status: 'open', order: 2 }, 'b.md': { type: 'PBI', status: 'Doing', order: 1 }, 'c.md': { type: 'PBI', status: 'Closed' },
      'd.md': { type: 'PBI', status: 'Parked' }, 'e.md': { type: 'PBI' }, 'f.md': { type: 'Deliverable', status: 'Built' },
    };
    const options = { stateValues: 'Open, Doing, Done', doneValues: 'Done, Closed', 'wipLimit.doing': '2', 'columnPolicy.open': 'Ready to pull' };
    expect(board(notes, options)).toStrictEqual([
      { state: null, outsideWorkflow: false, done: false, limit: null, policy: '', cards: ['e'], count: 1, held: 1 },
      { state: 'Open', outsideWorkflow: false, done: false, limit: null, policy: 'Ready to pull', cards: ['a'], count: 1, held: 1 },
      { state: 'Doing', outsideWorkflow: false, done: false, limit: 2, policy: '', cards: ['b'], count: 1, held: 1 },
      { state: 'Done', outsideWorkflow: false, done: true, limit: null, policy: '', cards: [], count: 0, held: 0 },
      { state: 'Parked', outsideWorkflow: true, done: false, limit: null, policy: '', cards: ['d'], count: 1, held: 1 },
      { state: 'Closed', outsideWorkflow: true, done: true, limit: null, policy: '', cards: ['c'], count: 1, held: 1 },
    ]);
  });

  it('builds columns from observed states plus a done value when none are configured', () => {
    const notes = { 'a.md': { type: 'PBI', status: 'Open' }, 'b.md': { type: 'Bug', status: 'review' } };
    expect(board(notes).map(column => [column.state, column.outsideWorkflow, column.done, column.cards])).toStrictEqual([
      [null, false, false, []], ['Open', false, false, ['a']], ['review', false, false, ['b']], ['Done', false, true, []],
    ]);
  });

  it('sorts cards by result order and holds only plan items', () => {
    const notes = {
      'a.md': { type: 'PBI', status: 'Open', order: 1 }, 'b.md': { type: 'PBI', status: 'Open', order: 2 }, 'c.md': { type: 'Milestone', status: 'Open', order: 3 },
      'i.md': { type: 'Iteration', status: 'Open' }, 'r.md': { type: 'Release', status: 'Open' },
    };
    expect(board(notes, { stateValues: 'Open' }, ['c.md', 'b.md', 'i.md', 'r.md', 'a.md'])[1]).toStrictEqual(
      { state: 'Open', outsideWorkflow: false, done: false, limit: null, policy: '', cards: ['c', 'b', 'a'], count: 3, held: 3 },
    );
  });
});
