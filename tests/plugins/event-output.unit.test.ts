import { describe, expect, it } from 'vitest';
import { eventOutput, isChangeRecord, selectEventOutput } from '../../src/the-forge/application/plugins/event-output.ts';
import { AppError } from '../../src/the-forge/domain/shared/errors.ts';

const history = [
  { id: 'command.started', payload: {} },
  { id: 'workspace.started', payload: {} },
  { id: 'file.created', payload: { path: 'a.md' } },
  { id: 'file.updated', payload: { path: 'b.md' } },
  { id: 'file.deleted', payload: { path: 'c.md' } },
  { id: 'quality.checked', payload: {} },
  { id: 'workspace.succeeded', payload: {} },
];

describe('response event output', () => {
  it('returns only committed file changes by default level changes', () => {
    expect(selectEventOutput(history, 'changes').map(record => record.id)).toEqual(['file.created', 'file.updated', 'file.deleted']);
    expect(history.filter(isChangeRecord)).toHaveLength(3);
  });

  it('returns the full history for all and nothing for none without mutating the history', () => {
    const all = selectEventOutput(history, 'all');
    expect(all).toEqual(history);
    expect(all).not.toBe(history);
    expect(selectEventOutput(history, 'none')).toEqual([]);
    expect(history).toHaveLength(7);
  });

  it('accepts only documented levels', () => {
    expect(['none', 'changes', 'all'].map(eventOutput)).toEqual(['none', 'changes', 'all']);
    expect(() => eventOutput('lifecycle')).toThrow(AppError);
    expect(() => eventOutput('lifecycle')).toThrow(/none, changes, all/);
  });
});
