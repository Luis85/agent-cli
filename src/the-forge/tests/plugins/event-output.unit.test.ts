import { describe, expect, it } from 'vitest';
import { eventOutput, isChangeRecord, selectEventOutput } from '../../src/application/plugins/event-output.ts';
import { AppError } from '../../src/domain/shared/errors.ts';

const history = [
  { id: 'command.started', payload: {} },
  { id: 'operation.started', payload: {} },
  { id: 'vault.create', payload: { path: 'a.md' } },
  { id: 'vault.modify', payload: { path: 'b.md' } },
  { id: 'vault.delete', payload: { path: 'c.md' } },
  { id: 'vault.rename', payload: { path: 'e.md', oldPath: 'd.md' } },
  { id: 'metadataCache.changed', payload: { path: 'e.md', cache: {} } },
  { id: 'workspace.quick-preview', payload: { path: 'f.md' } },
  { id: 'workspace.file-open', payload: { path: 'g.md' } },
  { id: 'quality.checked', payload: {} },
  { id: 'operation.succeeded', payload: {} },
];

describe('response event output', () => {
  it('returns only committed vault.* changes by default level changes', () => {
    expect(selectEventOutput(history, 'changes').map(record => record.id)).toEqual(['vault.create', 'vault.modify', 'vault.delete', 'vault.rename']);
    expect(history.filter(isChangeRecord)).toHaveLength(4);
  });

  it('returns the full history for all and nothing for none without mutating the history', () => {
    const all = selectEventOutput(history, 'all');
    expect(all).toEqual(history);
    expect(all).not.toBe(history);
    expect(selectEventOutput(history, 'none')).toEqual([]);
    expect(history).toHaveLength(11);
  });

  it('accepts only documented levels', () => {
    expect(['none', 'changes', 'all'].map(eventOutput)).toEqual(['none', 'changes', 'all']);
    expect(() => eventOutput('lifecycle')).toThrow(AppError);
    expect(() => eventOutput('lifecycle')).toThrow(/none, changes, all/);
  });
});
