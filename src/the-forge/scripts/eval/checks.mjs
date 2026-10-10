import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';

/**
 * @typedef {import('./tasks.mjs').Check} Check
 * @typedef {import('./tasks.mjs').AnswerAssertion} AnswerAssertion
 * @typedef {import('./tasks.mjs').DataAssertion} DataAssertion
 * @typedef {import('./workspace.mjs').EvalWorkspace} EvalWorkspace
 * @typedef {{ check: string, passed: boolean, detail?: string }} CheckResult
 */

/** Resolves an RFC 6901 JSON Pointer; `undefined` when a segment is missing. @param {unknown} value @param {string} pointer */
function resolvePointer(value, pointer) {
  if (pointer === '') return value;
  /** @type {any} */
  let current = value;
  for (const raw of pointer.slice(1).split('/')) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Whether `actual` contains every key of `expected` with a matching value, recursively. @param {unknown} actual @param {unknown} expected @returns {boolean} */
function matches(actual, expected) {
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) return isDeepStrictEqual(actual, expected);
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const record = /** @type {Record<string, unknown>} */ (actual);
  return Object.entries(expected).every(([key, value]) => Object.hasOwn(record, key) && matches(record[key], value));
}

/**
 * `equals` compares deeply; `contains` finds a substring of a string or a matching element of an array; `length`
 * counts an array or string.
 * @param {unknown} root @param {DataAssertion} assertion @returns {string | undefined} the failure, if any
 */
function assertData(root, assertion) {
  const value = resolvePointer(root, assertion.pointer);
  const shown = JSON.stringify(value)?.slice(0, 200);
  if ('equals' in assertion && !isDeepStrictEqual(value, assertion.equals)) return `${assertion.pointer} is ${shown}, expected ${JSON.stringify(assertion.equals)}`;
  if ('contains' in assertion) {
    const found = typeof value === 'string' ? typeof assertion.contains === 'string' && value.includes(assertion.contains)
      : Array.isArray(value) && value.some(item => matches(item, assertion.contains));
    if (!found) return `${assertion.pointer} (${shown}) does not contain ${JSON.stringify(assertion.contains)}`;
  }
  if (assertion.length !== undefined && !((Array.isArray(value) || typeof value === 'string') && value.length === assertion.length)) return `${assertion.pointer} (${shown}) does not have length ${assertion.length}`;
  return undefined;
}

/** Parsed structured content: JSON for .json and .canvas, YAML for .base, .yaml and .yml. @param {string} path @param {string} text */
function structured(path, text) {
  return /\.(?:json|canvas)$/.test(path) ? JSON.parse(text) : parse(text);
}

/** @param {string} text */
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  return match ? parse(match[1] ?? '') ?? {} : {};
}

/**
 * An answer check, ignoring letter case: `contains` must all occur and `notContains` none. `items` is an exact set
 * of vault paths: the answer names each one and no other path of the fixture, except the `ignore` paths (such as
 * the note the question is about), so an answer that lists every path fails.
 * @param {EvalWorkspace} workspace @param {AnswerAssertion} check @param {string} answer
 * @returns {string | undefined} the failure, if any
 */
export function answerFailure(workspace, check, answer) {
  const text = answer.toLowerCase();
  const missing = [...check.contains ?? [], ...check.items ?? []].filter(item => !text.includes(item.toLowerCase()));
  if (missing.length) return `the answer does not mention ${missing.join(', ')}`;
  const excluded = (check.notContains ?? []).filter(item => text.includes(item.toLowerCase()));
  if (excluded.length) return `the answer mentions ${excluded.join(', ')}`;
  if (check.items === undefined) return undefined;
  // Remove the expected and ignored paths first, so a path that is part of a longer one is not counted twice.
  const named = [...check.items, ...check.ignore ?? []].map(item => item.toLowerCase()).sort((a, b) => b.length - a.length);
  const rest = named.reduce((remaining, item) => remaining.replaceAll(item, ' '), text);
  const extra = workspace.vaultPaths.filter(path => !named.includes(path.toLowerCase()) && rest.includes(path.toLowerCase()));
  return extra.length ? `the answer also names ${extra.join(', ')}, beyond exactly ${check.items.join(', ')}` : undefined;
}

/**
 * @param {EvalWorkspace} workspace @param {Check} check @param {string} answer
 * @returns {Promise<string | undefined>} the failure, if any
 */
async function failure(workspace, check, answer) {
  if ('answer' in check) return answerFailure(workspace, check.answer, answer);
  if ('unchanged' in check) {
    const before = workspace.prepared(check.unchanged);
    const after = await readFile(join(workspace.root, check.unchanged)).catch(() => undefined);
    return before && after && before.equals(after) ? undefined : `${check.unchanged} changed or disappeared`;
  }
  if ('command' in check) {
    const result = await workspace.forge(check.command);
    if (check.code !== undefined) return result.body.error?.code === check.code ? undefined : `expected ${check.code}, got ${result.body.error?.code ?? 'success'}`;
    if (result.body.ok !== true) return `failed with ${result.body.error?.code}: ${result.body.error?.message}`;
    return check.data ? assertData(result.body.data, check.data) : undefined;
  }
  const text = await readFile(join(workspace.root, check.file), 'utf8').catch(() => undefined);
  if (check.exists === false) return text === undefined ? undefined : `${check.file} still exists`;
  if (text === undefined) return `${check.file} does not exist`;
  const absent = (check.contains ?? []).filter(item => !text.includes(item));
  if (absent.length) return `${check.file} lacks ${absent.map(item => JSON.stringify(item)).join(', ')}`;
  const present = (check.notContains ?? []).filter(item => text.includes(item));
  if (present.length) return `${check.file} still contains ${present.map(item => JSON.stringify(item)).join(', ')}`;
  if (check.frontmatter && !matches(frontmatter(text), check.frontmatter)) return `${check.file} frontmatter ${JSON.stringify(frontmatter(text))} does not match ${JSON.stringify(check.frontmatter)}`;
  return check.data ? assertData(structured(check.file, text), check.data) : undefined;
}

/** A short label for reports. @param {Check} check */
export function describeCheck(check) {
  if ('answer' in check) {
    const { contains = [], notContains = [], items } = check.answer;
    return [items ? `answer names exactly ${items.join(', ')}` : '', contains.length ? `answer mentions ${contains.join(', ')}` : '', notContains.length ? `not ${notContains.join(', ')}` : ''].filter(Boolean).join('; ');
  }
  if ('unchanged' in check) return `${check.unchanged} unchanged`;
  if ('command' in check) return `${check.command.join(' ')}${check.code ? ` fails with ${check.code}` : ''}${check.data ? ` ${check.data.pointer}` : ''}`;
  return `${check.file}${check.exists === false ? ' absent' : ''}${check.contains ? ' contains' : ''}${check.frontmatter ? ' frontmatter' : ''}${check.data ? ` ${check.data.pointer}` : ''}`;
}

/**
 * Evaluates every check of a task against the workspace's end state and the agent's final answer.
 * @param {EvalWorkspace} workspace @param {Check[]} checks @param {string} answer
 * @returns {Promise<CheckResult[]>}
 */
export async function evaluateChecks(workspace, checks, answer) {
  const results = [];
  for (const check of checks) {
    let detail;
    try { detail = await failure(workspace, check, answer); }
    catch (error) { detail = error instanceof Error ? error.message : String(error); }
    results.push({ check: describeCheck(check), passed: detail === undefined, ...(detail === undefined ? {} : { detail }) });
  }
  return results;
}
