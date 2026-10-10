import { evaluateChecks } from './checks.mjs';
import { asStep } from './tasks.mjs';
import { createWorkspace, meets } from './workspace.mjs';

/**
 * @typedef {import('./tasks.mjs').Task} Task
 * @typedef {import('./checks.mjs').CheckResult} CheckResult
 * @typedef {{ run: string[], status: number | null, code?: string }} StepResult
 * @typedef {{ id: string, driver: 'reference', passed: boolean, failures: string[], steps: StepResult[], baseline: CheckResult[], checks: CheckResult[] }} ReferenceResult
 */

/**
 * The reference driver proves a task is solvable and its checks are meaningful: on the prepared fixture at least
 * one check must fail (so checks cannot pass vacuously), every reference step must succeed or fail with its
 * expected code, and afterwards every check must pass, the answer check against the task's reference answer.
 * @param {Task} task @param {{ distribution?: string }} [options] @returns {Promise<ReferenceResult>}
 */
export async function runReference(task, options = {}) {
  const workspace = await createWorkspace(task, options);
  /** @type {string[]} */
  const failures = [];
  /** @type {StepResult[]} */
  const steps = [];
  try {
    const baseline = await evaluateChecks(workspace, task.checks, '');
    if (baseline.every(check => check.passed)) failures.push('every check already passes on the prepared fixture');
    for (const step of task.reference.map(asStep)) {
      const run = await Promise.all(step.run.map(workspace.expand));
      const result = await workspace.forge(run);
      const code = result.body.error?.code;
      steps.push({ run, status: result.status, ...(code === undefined ? {} : { code }) });
      if (!meets(result, step.expect)) {
        failures.push(`${run.join(' ')}: expected ${step.expect ? step.expect.code : 'success'}, got ${code ?? 'success'}${code ? ` (${result.body.error.message})` : ''}`);
        break;
      }
    }
    const checks = await evaluateChecks(workspace, task.checks, task.answer ?? '');
    for (const check of checks) if (!check.passed) failures.push(`check ${check.check}: ${check.detail}`);
    return { id: task.id, driver: 'reference', passed: failures.length === 0, failures, steps, baseline, checks };
  } finally {
    await workspace.dispose();
  }
}
