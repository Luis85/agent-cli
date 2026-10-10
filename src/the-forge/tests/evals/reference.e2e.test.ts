import { beforeAll, describe, expect, it } from 'vitest';
import { commandIds, loadTasks, type Task } from '../../scripts/eval/tasks.mjs';
import { runReference } from '../../scripts/eval/reference.mjs';
import { createWorkspace } from '../../scripts/eval/workspace.mjs';
import { distribution } from '../support/workspace.ts';

const tasks = loadTasks();
let commands: string[];

beforeAll(async () => {
  const workspace = await createWorkspace(tasks[0]!, { distribution });
  try { commands = (await workspace.forge(['schema'])).body.data.commands.map((command: { id: string }) => command.id); }
  finally { await workspace.dispose(); }
});

describe('agent evaluation tasks under the reference driver', () => {
  it('use only commands that the built executable registers', () => {
    for (const task of tasks) for (const id of commandIds(task)) expect(commands, `${task.id} uses ${id}`).toContain(id);
  });

  // Each task copies the built distribution into a fresh workspace and runs a dozen CLI processes.
  it.concurrent.each(tasks.map(task => [task.id, task] as const))('%s is solvable with its reference commands and its checks discriminate', async (_id, task) => {
    const result = await runReference(task, { distribution });
    expect(result.failures).toEqual([]);
    expect(result.baseline.some(check => !check.passed)).toBe(true);
    expect(result.checks.every(check => check.passed)).toBe(true);
  }, 120_000);

  it('fails a task whose checks pass before any work or cannot be met', async () => {
    const task = tasks.find(candidate => candidate.id === 'edit-append')!;
    const vacuous: Task = { ...task, id: 'vacuous', checks: [{ file: 'Home.md', exists: true }] };
    expect((await runReference(vacuous, { distribution })).failures).toEqual(['every check already passes on the prepared fixture']);
    const impossible: Task = { ...task, id: 'impossible', checks: [{ file: 'Meetings/2026-10-01.md', contains: ['- [ ] Book a helicopter'] }] };
    const result = await runReference(impossible, { distribution });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([expect.stringContaining('lacks "- [ ] Book a helicopter"')]);
    const wrongStep: Task = { ...task, id: 'wrong-step', reference: [{ run: ['read', 'Missing.md'] }] };
    expect((await runReference(wrongStep, { distribution })).failures[0]).toContain('read Missing.md: expected success, got NOT_FOUND');
  }, 120_000);
});
