import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';

/** The Forge project root, which owns `evals/` and `package.json`. */
export const projectRoot = resolve(import.meta.dirname, '../..');
export const evalsRoot = join(projectRoot, 'evals');

/**
 * @typedef {string[]} Args Forge arguments after `node bin/forge.js`, without routing or output options.
 * @typedef {{ run: Args, expect?: { code: string } }} Step A command; `expect.code` makes it an expected failure.
 * @typedef {{ pointer: string, equals?: unknown, contains?: unknown, length?: number }} DataAssertion
 * @typedef {{ file: string, exists?: boolean, contains?: string[], notContains?: string[], frontmatter?: Record<string, unknown>, data?: DataAssertion }} FileCheck
 * @typedef {{ command: Args, code?: string, data?: DataAssertion }} CommandCheck
 * @typedef {{ unchanged: string }} UnchangedCheck
 * @typedef {{ answer: { contains: string[] } }} AnswerCheck
 * @typedef {FileCheck | CommandCheck | UnchangedCheck | AnswerCheck} Check
 * @typedef {{
 *   id: string, title: string, category: string, prompt: string, fixture: string,
 *   setup?: Array<Args | Step>, reference: Array<Args | Step>, answer?: string, checks: Check[],
 * }} Task
 */

export const categories = ['reading', 'searching', 'linking', 'editing', 'canvas-bases', 'backlog', 'generation', 'projects', 'error-recovery'];

const args = { type: 'array', minItems: 1, items: { type: 'string' } };
const step = { oneOf: [args, {
  type: 'object', additionalProperties: false, required: ['run'],
  properties: { run: args, expect: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string' } } } },
}] };
const texts = { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } };
const data = {
  type: 'object', additionalProperties: false, required: ['pointer'], minProperties: 2,
  properties: { pointer: { type: 'string', pattern: '^(/|$)' }, equals: {}, contains: {}, length: { type: 'integer', minimum: 0 } },
};
const check = { oneOf: [
  {
    type: 'object', additionalProperties: false, required: ['file'], minProperties: 2,
    properties: { file: { type: 'string' }, exists: { type: 'boolean' }, contains: texts, notContains: texts, frontmatter: { type: 'object', minProperties: 1 }, data },
  },
  { type: 'object', additionalProperties: false, required: ['command'], properties: { command: args, code: { type: 'string' }, data } },
  { type: 'object', additionalProperties: false, required: ['unchanged'], properties: { unchanged: { type: 'string' } } },
  { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'object', additionalProperties: false, required: ['contains'], properties: { contains: texts } } } },
] };

/** JSON Schema 2020-12 of one task file. */
export const taskSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Forge agent evaluation task',
  type: 'object', additionalProperties: false, required: ['id', 'title', 'category', 'prompt', 'fixture', 'reference', 'checks'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }, title: { type: 'string', minLength: 1 },
    category: { enum: categories }, prompt: { type: 'string', minLength: 20 }, fixture: { type: 'string', pattern: '^[a-z0-9-]+$' },
    setup: { type: 'array', items: step }, reference: { type: 'array', minItems: 1, items: step },
    answer: { type: 'string', minLength: 1 }, checks: { type: 'array', minItems: 1, items: check },
  },
};

const validateTask = new Ajv2020({ strict: true, allErrors: true }).compile(taskSchema);

/** @param {Args | Step} value @returns {Step} */
export const asStep = value => Array.isArray(value) ? { run: value } : value;

/**
 * Loads and validates every task file: schema, file name equal to the id, an existing fixture, an answer exactly
 * when an answer check exists, and unique ids. Problems throw with the file name.
 * @param {string} [directory]
 * @returns {Task[]}
 */
export function loadTasks(directory = join(evalsRoot, 'tasks')) {
  const files = readdirSync(directory).filter(name => name.endsWith('.yaml')).sort();
  return files.map(name => {
    const task = parse(readFileSync(join(directory, name), 'utf8'));
    if (!validateTask(task)) throw new Error(`${name}: ${JSON.stringify(validateTask.errors)}`);
    const typed = /** @type {Task} */ (task);
    if (`${typed.id}.yaml` !== name) throw new Error(`${name}: the file name must be ${typed.id}.yaml`);
    if (!existsSync(join(evalsRoot, 'fixtures', typed.fixture))) throw new Error(`${name}: missing fixture ${typed.fixture}`);
    const asksAnswer = typed.checks.some(item => 'answer' in item);
    if (asksAnswer !== (typed.answer !== undefined)) throw new Error(`${name}: an answer check needs a reference answer, and an answer needs an answer check`);
    return typed;
  });
}

/**
 * Every Forge command id a task uses in setup, reference steps and command checks.
 * @param {Task} task
 */
export function commandIds(task) {
  const steps = [...task.setup ?? [], ...task.reference].map(item => asStep(item).run[0]);
  const checks = task.checks.flatMap(item => 'command' in item ? [item.command[0]] : []);
  return [...new Set([...steps, ...checks])].filter(/** @returns {id is string} */ id => id !== undefined);
}
