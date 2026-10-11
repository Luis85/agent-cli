import { isRecord } from '../../../domain/shared/errors.ts';
import { ensureBrowser, browserError } from './errors.ts';

export type TutorialLocator = { role: string; name?: string } | { label: string } | { testId: string } | { css: string };
export type TutorialAction =
  | { type: 'goto'; url: string }
  | { type: 'click'; locator: TutorialLocator }
  | { type: 'fill'; locator: TutorialLocator; value: string; valueFromEnv?: never }
  | { type: 'fill'; locator: TutorialLocator; valueFromEnv: string; value?: never }
  | { type: 'select'; locator: TutorialLocator; value: string }
  | { type: 'check'; locator: TutorialLocator; checked: boolean }
  | { type: 'press'; locator: TutorialLocator; key: string }
  | { type: 'wait'; locator: TutorialLocator; state: 'visible' | 'hidden' | 'attached' | 'detached' };
export interface TutorialStep { id: string; title: string; text?: string; actions: TutorialAction[]; screenshot: boolean; fullPage: boolean }
export interface TutorialPlan { version: 1; title: string; description?: string; startUrl: string; viewport: { width: number; height: number }; steps: TutorialStep[] }

function valid(condition: unknown, message: string): asserts condition { ensureBrowser(condition, 'BROWSER_FLOW_INVALID', message); }
function record(value: unknown, keys: string[], location: string): Record<string, unknown> {
  valid(isRecord(value), `${location} must be an object.`);
  valid(Object.keys(value).every(key => keys.includes(key)), `${location} contains an unknown field.`);
  return value;
}
function text(value: unknown, location: string, allowEmpty = false): string {
  valid(typeof value === 'string' && value.length <= 20_000 && (allowEmpty || value.trim().length > 0), `${location} must be ${allowEmpty ? 'a' : 'a nonempty'} string of at most 20000 characters.`);
  return value;
}
function url(value: unknown): string {
  const input = text(value, 'URL');
  let parsed: URL;
  try { parsed = new URL(input); } catch { throw browserError('BROWSER_FLOW_INVALID', 'Tutorial URLs must be absolute HTTP or HTTPS URLs.'); }
  valid(['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && ![...new URLSearchParams(parsed.hash.slice(1)).keys()].some(key => key.toLowerCase() === 'token'),
    'Tutorial URLs must use HTTP or HTTPS without embedded credentials or launch-token fragments; keep secrets outside saved plans.');
  return parsed.href;
}
function locator(value: unknown): TutorialLocator {
  const item = record(value, ['role', 'name', 'label', 'testId', 'css'], 'Locator');
  const kinds = ['role', 'label', 'testId', 'css'].filter(key => item[key] !== undefined);
  valid(kinds.length === 1 && (item.name === undefined || kinds[0] === 'role'), 'A locator must specify exactly one of role, label, testId or css; only role accepts name.');
  const kind = kinds[0]!;
  const result = { [kind]: text(item[kind], `Locator ${kind}`), ...(item.name === undefined ? {} : { name: text(item.name, 'Locator name') }) };
  return result as TutorialLocator;
}
function action(value: unknown): TutorialAction {
  valid(isRecord(value), 'Every action must be an object.');
  const type = value.type;
  const fields: Record<string, string[]> = { goto: ['url'], click: ['locator'], fill: ['locator', 'value', 'valueFromEnv'], select: ['locator', 'value'], check: ['locator', 'checked'], press: ['locator', 'key'], wait: ['locator', 'state'] };
  valid(typeof type === 'string' && Object.hasOwn(fields, type), 'Unknown tutorial action; use goto, click, fill, select, check, press or wait.');
  record(value, ['type', ...fields[type]!], `Action ${type}`);
  if (type === 'goto') return { type, url: url(value.url) };
  const target = locator(value.locator);
  switch (type) {
    case 'click': return { type, locator: target };
    case 'fill': {
      valid((value.value === undefined) !== (value.valueFromEnv === undefined), 'fill requires exactly one of value or valueFromEnv.');
      if (value.valueFromEnv !== undefined) {
        const variable = text(value.valueFromEnv, 'Environment variable');
        valid(/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable), 'valueFromEnv must name an environment variable.');
        return { type, locator: target, valueFromEnv: variable };
      }
      return { type, locator: target, value: text(value.value, 'Fill value', true) };
    }
    case 'select': return { type, locator: target, value: text(value.value, 'Select value', true) };
    case 'check': valid(typeof value.checked === 'boolean', 'check requires checked: true or false.'); return { type, locator: target, checked: value.checked };
    case 'press': return { type, locator: target, key: text(value.key, 'Key') };
    default: {
      const state = value.state ?? 'visible';
      valid(['visible', 'hidden', 'attached', 'detached'].includes(state as string), 'wait state must be visible, hidden, attached or detached.');
      return { type: 'wait', locator: target, state: state as 'visible' | 'hidden' | 'attached' | 'detached' };
    }
  }
}

export function tutorialPlan(value: unknown): TutorialPlan {
  const plan = record(value, ['version', 'title', 'description', 'startUrl', 'viewport', 'steps'], 'Plan');
  valid(plan.version === 1, 'Tutorial plan version must be 1.');
  const viewport = plan.viewport === undefined ? { width: 1440, height: 900 } : record(plan.viewport, ['width', 'height'], 'Viewport');
  valid(Number.isSafeInteger(viewport.width) && Number(viewport.width) >= 1 && Number(viewport.width) <= 4096 && Number.isSafeInteger(viewport.height) && Number(viewport.height) >= 1 && Number(viewport.height) <= 4096, 'Viewport dimensions must be integers from 1 to 4096.');
  valid(Array.isArray(plan.steps) && plan.steps.length > 0 && plan.steps.length <= 100, 'A tutorial needs 1 to 100 steps.');
  const ids = new Set<string>();
  let count = 0;
  const steps = plan.steps.map((value, index) => {
    const step = record(value, ['id', 'title', 'text', 'actions', 'screenshot', 'fullPage'], `Step ${index + 1}`);
    const id = text(step.id, 'Step id');
    valid(/^[a-z][a-z0-9-]{0,63}$/.test(id) && !ids.has(id), 'Step ids must be unique lowercase kebab-case names of at most 64 characters.');
    ids.add(id);
    valid(Array.isArray(step.actions) && (count += step.actions.length) <= 500, 'Steps require an actions array, with at most 500 actions per tutorial.');
    valid(step.screenshot === undefined || typeof step.screenshot === 'boolean', 'screenshot must be boolean.');
    valid(step.fullPage === undefined || typeof step.fullPage === 'boolean', 'fullPage must be boolean.');
    return { id, title: text(step.title, 'Step title'), ...(step.text === undefined ? {} : { text: text(step.text, 'Step text', true) }),
      actions: step.actions.map(action), screenshot: step.screenshot !== false, fullPage: step.fullPage !== false };
  });
  return { version: 1, title: text(plan.title, 'Title'), ...(plan.description === undefined ? {} : { description: text(plan.description, 'Description', true) }),
    startUrl: url(plan.startUrl), viewport: { width: Number(viewport.width), height: Number(viewport.height) }, steps };
}

function json(text: string): unknown {
  try { return JSON.parse(text); } catch { throw browserError('BROWSER_FLOW_INVALID', 'Tutorial source must contain valid JSON.'); }
}
function blocks(text: string): string[] {
  return [...text.matchAll(/^ {0,3}(`{3,}|~{3,})forge-tutorial[ \t]*\r?\n([\s\S]*?)^ {0,3}\1[ \t]*\r?$/gm)].map(match => match[2]!);
}
/** Markdown and Canvas remain human-authored; exactly one explicit executable plan is required. */
export function extractTutorial(source: string, path: string): TutorialPlan {
  valid(source.length <= 2_000_000, 'Tutorial source exceeds the 2 MB limit.');
  if (/\.json$/i.test(path)) return tutorialPlan(json(source));
  let candidates: string[];
  if (/\.canvas$/i.test(path)) {
    const canvas = json(source);
    valid(isRecord(canvas) && Array.isArray(canvas.nodes), 'Canvas must contain a nodes array.');
    candidates = canvas.nodes.flatMap(node => isRecord(node) && node.type === 'text' && typeof node.text === 'string' ? blocks(node.text) : []);
  } else {
    valid(/\.md$/i.test(path), 'Use a JSON plan, Markdown document or Canvas document.');
    candidates = blocks(source);
  }
  valid(candidates.length === 1, 'Markdown or Canvas must contain exactly one fenced forge-tutorial JSON block. Ask the agent to translate the intended flow into a reviewed plan first.');
  return tutorialPlan(json(candidates[0]!));
}
