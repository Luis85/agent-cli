import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { categories, commandIds, loadTasks, taskSchema } from '../../scripts/eval/tasks.mjs';
import { summarizeStream } from '../../scripts/eval/claude.mjs';
import { describeCheck } from '../../scripts/eval/checks.mjs';

const tasks = loadTasks();

describe('agent evaluation task files', () => {
  it('define 20 to 30 tasks with unique ids that cover every category', () => {
    expect(tasks.length).toBeGreaterThanOrEqual(20);
    expect(tasks.length).toBeLessThanOrEqual(30);
    expect(new Set(tasks.map(task => task.id)).size).toBe(tasks.length);
    expect(new Set(tasks.map(task => task.category))).toEqual(new Set(categories));
  });

  it('publish a strict JSON Schema 2020-12 task format', () => {
    const ajv = new Ajv2020({ strict: true });
    expect(ajv.validateSchema(taskSchema)).toBe(true);
    const validate = ajv.compile(taskSchema);
    const task = { id: 'x-task', title: 'X', category: 'reading', prompt: 'Read the note and answer.', fixture: 'vault', reference: [['read', 'Home.md']], checks: [{ file: 'Home.md', exists: true }] };
    expect(validate(task)).toBe(true);
    expect(validate({ ...task, checks: [{ file: 'Home.md' }] })).toBe(false);
    expect(validate({ ...task, checks: [{ command: ['list'], exists: true }] })).toBe(false);
    expect(validate({ ...task, reference: [{ run: ['read'], expect: { ok: true } }] })).toBe(false);
    expect(validate({ ...task, category: 'other' })).toBe(false);
  });

  it('collect the command ids of setup, reference steps and command checks', () => {
    const stale = tasks.find(task => task.id === 'recover-stale-revision')!;
    expect(commandIds(stale)).toEqual(['edit', 'read']);
    expect(commandIds(tasks.find(task => task.id === 'links-fix-unresolved')!)).toEqual(['links', 'edit']);
    expect(describeCheck({ command: ['links', 'unresolved'], data: { pointer: '/links', length: 0 } })).toBe('links unresolved /links');
  });
});

describe('the claude driver transcript summary', () => {
  it('counts Forge, shell and native tool calls, Forge error codes and the final result metrics', () => {
    const lines = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node bin/forge.js read Home.md --json' } }, { type: 'text', text: 'Reading' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: '{"ok":false,"error":{"code":"CONFLICT","message":"File changed"}}' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'Home.md' } }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '{"ok": false, "error": {"code": "NOT_FOUND"}}' }] }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Done: Alpha is active.', num_turns: 4, duration_ms: 1200, total_cost_usd: 0.02, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } },
    ];
    expect(summarizeStream(`${lines.map(line => JSON.stringify(line)).join('\n')}\nnot json`)).toEqual({
      answer: 'Done: Alpha is active.', isError: false, turns: 4, durationMs: 1200, costUsd: 0.02,
      tokens: { input: 10, output: 5, cacheRead: 100, cacheCreation: 0 },
      toolCalls: { total: 3, forge: 1, otherBash: 1, native: { Read: 1 } }, forgeErrors: ['CONFLICT', 'NOT_FOUND'],
    });
    expect(summarizeStream('')).toMatchObject({ answer: '', isError: true, turns: null, tokens: null });
  });
});
