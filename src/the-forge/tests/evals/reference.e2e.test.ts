import { beforeAll, describe, expect, it } from 'vitest';
import { commandIds, loadTasks, type Task } from '../../scripts/eval/tasks.mjs';
import { runReference, type ReferenceResult } from '../../scripts/eval/reference.mjs';
import { createWorkspace } from '../../scripts/eval/workspace.mjs';
import { distribution } from '../support/workspace.ts';

const tasks = loadTasks();
/** Each outcome, or the error that ended it, so one failing task fails only its own test. */
let commands: string[] | Error;
const results = new Map<string, ReferenceResult | Error>();
const failure = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));
const outcome = <Value>(value: Value | Error): Value => {
  if (value instanceof Error) throw value;
  return value;
};
/** Tasks in flight at once: each copies the built distribution and runs a dozen CLI processes. */
const concurrency = 2;

beforeAll(async () => {
  try {
    const workspace = await createWorkspace(tasks[0]!, { distribution });
    try { commands = (await workspace.forge(['schema'])).body.data.commands.map((command: { id: string }) => command.id); }
    finally { await workspace.dispose(); }
  } catch (error) { commands = failure(error); }
  // A small fixed pool keeps the suite's parallel load bounded instead of starting every task at once.
  const queue = [...tasks];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      results.set(task.id, await runReference(task, { distribution }).catch(failure));
    }
  }));
}, 900_000);

describe('agent evaluation tasks under the reference driver', () => {
  it('use only commands that the built executable registers', () => {
    const registered = outcome(commands);
    for (const task of tasks) for (const id of commandIds(task)) expect(registered, `${task.id} uses ${id}`).toContain(id);
  });

  it.each(tasks.map(task => task.id))('%s is solvable with its reference commands and its checks discriminate', id => {
    const result = outcome(results.get(id)!);
    expect(result.failures).toEqual([]);
    expect(result.baseline.some(check => !check.passed)).toBe(true);
    expect(result.checks.every(check => check.passed)).toBe(true);
  });

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

  it('names the task, the arguments and the working directory when the CLI cannot start', async () => {
    const workspace = await createWorkspace(tasks[0]!, { distribution });
    await workspace.dispose();
    await expect(workspace.forge(['schema'])).rejects.toThrow(`${tasks[0]!.id}: forge schema could not start in ${workspace.root} (missing)`);
  });

  it('rejects a reference answer that the reference commands do not support, although it passes its own check', async () => {
    const [list, property] = loadTasks('tests/evals/fixtures/wrong-tasks');
    const wrongList = await runReference(list!, { distribution });
    expect(wrongList.checks.every(check => check.passed)).toBe(true);
    expect(wrongList.failures).toEqual(['the reference output does not support the answer "Projects/Gamma.md"']);
    expect((await runReference(property!, { distribution })).failures).toEqual(['the reference output does not support the answer "paused"']);
  }, 120_000);
});
