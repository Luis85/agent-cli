import { describe, expect, it } from 'vitest';
import { extractTutorial, tutorialPlan } from '../../src/plugins/browser/domain/tutorial.ts';
const base = () => ({ version: 1, title: 'Create a note', startUrl: 'http://localhost:4100/#/notes', steps: [
  { id: 'open', title: 'Open notes', actions: [{ type: 'click', locator: { role: 'button', name: 'New note' } }] },
] });
const block = (plan = base()) => `\`\`\`forge-tutorial\n${JSON.stringify(plan)}\n\`\`\``;
describe('tutorial plan validation and extraction', () => {
  it('normalizes defaults and preserves hash routes and role locators', () => {
    expect(tutorialPlan(base())).toMatchObject({ viewport: { width: 1440, height: 900 }, startUrl: base().startUrl,
      steps: [{ screenshot: true, fullPage: true, actions: [{ locator: { role: 'button', name: 'New note' } }] }] });
  });
  it.each(['json', 'md', 'canvas'])('extracts an explicit plan from %s', extension => {
    const source = extension === 'json' ? JSON.stringify(base()) : extension === 'md' ? `# Intent\n${block()}\n` :
      JSON.stringify({ nodes: [{ type: 'text', text: block() }], edges: [] });
    expect(extractTutorial(source, `source.${extension}`)).toEqual(tutorialPlan(base()));
  });
  it('accepts CRLF fenced Markdown', () => {
    expect(extractTutorial(block().replaceAll('\n', '\r\n'), 'flow.md')).toEqual(tutorialPlan(base()));
  });
  it('rejects prose, ambiguous embedded plans and indirect Canvas references', () => {
    for (const [source, path] of [['Click new note', 'flow.md'], [`${block()}\n${block()}`, 'flow.md'],
      [JSON.stringify({ nodes: [{ type: 'file', file: 'flow.md' }] }), 'flow.canvas']]) {
      expect(() => extractTutorial(source!, path!)).toThrow('exactly one');
    }
  });
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'https://user:secret@example.org', 'http://localhost/#token=secret', 'http://localhost/#%74oken=secret'])('rejects unsafe persisted URL %s', startUrl => {
    expect(() => tutorialPlan({ ...base(), startUrl })).toThrow();
  });
  it.each([
    { type: 'evaluate', script: 'alert(1)' },
    { type: 'click', locator: { css: 'button', label: 'Add' } },
    { type: 'click', locator: { name: 'Add' } },
    { type: 'fill', locator: { label: 'Password' }, value: 'x', valueFromEnv: 'PASSWORD' },
    { type: 'fill', locator: { label: 'Password' }, valueFromEnv: 'BAD NAME' },
    { type: 'check', locator: { testId: 'accept' }, checked: 'true' },
  ])('rejects malformed or executable action %#', action => {
    expect(() => tutorialPlan({ ...base(), steps: [{ id: 'step', title: 'Step', actions: [action] }] })).toThrow();
  });
  it('accepts explicit actions and environment references without resolving them', () => {
    const actions = [
      { type: 'goto', url: 'https://example.org/#/settings' }, { type: 'fill', locator: { label: 'Password' }, valueFromEnv: 'PASSWORD' },
      { type: 'select', locator: { css: 'select' }, value: 'first' }, { type: 'check', locator: { testId: 'accept' }, checked: false },
      { type: 'press', locator: { label: 'Name' }, key: 'Enter' }, { type: 'wait', locator: { css: '.ready' } },
    ];
    expect(tutorialPlan({ ...base(), steps: [{ id: 'step', title: 'Step', actions }] }).steps[0]!.actions).toEqual([
      ...actions.slice(0, -1), { ...actions.at(-1), state: 'visible' },
    ]);
  });
  it('rejects duplicates, traversal ids, unknown fields and excessive work', () => {
    for (const value of [{ ...base(), extra: true }, { ...base(), steps: [...base().steps, ...base().steps] },
      { ...base(), steps: [{ ...base().steps[0], id: '../bad' }] }, { ...base(), viewport: { width: 4097, height: 900 } },
      { ...base(), steps: [{ ...base().steps[0], actions: Array(501).fill({ type: 'click', locator: { css: 'button' } }) }] }]) {
      expect(() => tutorialPlan(value)).toThrow();
    }
  });
});
