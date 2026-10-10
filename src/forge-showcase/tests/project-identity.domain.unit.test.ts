import { describe, expect, it } from 'vitest';
import { ProjectIdentity } from '../src/domain/project-identity.ts';

describe('ProjectIdentity', () => {
  it.each(['', '   '])('rejects an empty identity: %j', id => {
    expect(() => ProjectIdentity.create(id)).toThrow('Identity is required');
  });
  it('retains a valid identity', () => {
    expect(ProjectIdentity.create('item-1').id).toBe('item-1');
  });
});
