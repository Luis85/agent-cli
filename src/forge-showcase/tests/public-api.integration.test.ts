import { expect, it } from 'vitest';
import { ProjectIdentity } from '../src/index.ts';

it('exposes identity validation through the public API', () => {
  expect(() => ProjectIdentity.create('   ')).toThrow('Identity is required');
  expect(ProjectIdentity.create('project-1').id).toBe('project-1');
});
