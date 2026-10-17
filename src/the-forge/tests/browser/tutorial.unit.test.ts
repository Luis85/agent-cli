import { describe, expect, it } from 'vitest';
import { tutorialBlocks } from '../../src/plugins/browser/infrastructure/tutorial-markdown.ts';
import { extractTutorial as extract, tutorialPlan } from '../../src/plugins/browser/domain/tutorial.ts';
const extractTutorial = (source: string, path: string) => extract(source, path, tutorialBlocks);
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
  it.each([
    ['backticks', '```forge-tutorial', '```'],
    ['longer closing fence', '```forge-tutorial', '`````'],
    ['tildes', '~~~forge-tutorial', '~~~~'],
    ['indented fences and whitespace', '   ``` forge-tutorial\t', '   ````  '],
  ])('accepts CommonMark %s with LF and CRLF', (_name, open, close) => {
    for (const newline of ['\n', '\r\n']) {
      expect(extractTutorial([open, JSON.stringify(base()), close].join(newline), 'flow.md')).toEqual(tutorialPlan(base()));
    }
  });
  it.each([
    ['nested backticks', ['````markdown', block(), '````'].join('\n')],
    ['nested tildes', ['~~~~markdown', block(), '~~~~'].join('\n')],
    ['indented code', block().split('\n').map(line => `    ${line}`).join('\n')],
    ['HTML comment', ['<!--', block(), '-->'].join('\n')],
    ['inline code', `before \`\`\`forge-tutorial ${JSON.stringify(base())}\`\`\` after`],
    ['extra info text', block().replace('forge-tutorial', 'forge-tutorial example')],
  ])('ignores %s rather than interpreting it as an executable plan', (_name, example) => {
    expect(() => extractTutorial(example, 'flow.md')).toThrow('exactly one');
    expect(extractTutorial(`${example}\n\n${block()}`, 'flow.md')).toEqual(tutorialPlan(base()));
  });
  it.each(['> ', '- '])('extracts a fenced plan from a CommonMark container %s', prefix => {
    const nested = block().split('\n').map((line, index) => `${prefix === '- ' && index > 0 ? '  ' : prefix}${line}`).join('\n');
    expect(extractTutorial(nested, 'flow.md')).toEqual(tutorialPlan(base()));
  });
  it('parses each Canvas text node independently and rejects multiple executable plans', () => {
    const example = ['````markdown', block(), '````'].join('\n');
    const canvas = (texts: string[]) => JSON.stringify({ nodes: texts.map(text => ({ type: 'text', text })), edges: [] });
    expect(() => extractTutorial(canvas([example]), 'flow.canvas')).toThrow('exactly one');
    expect(extractTutorial(canvas([example, block()]), 'flow.canvas')).toEqual(tutorialPlan(base()));
    expect(() => extractTutorial(canvas([block(), block()]), 'flow.canvas')).toThrow('exactly one');
    expect(extractTutorial(canvas(['````markdown', block()]), 'flow.canvas')).toEqual(tutorialPlan(base()));
    expect(() => extractTutorial(canvas(['```forge-tutorial', `${JSON.stringify(base())}\n\`\`\``]), 'flow.canvas'))
      .toThrow(expect.objectContaining({ code: 'BROWSER_FLOW_INVALID', message: 'Tutorial source must contain valid JSON.' }));
  });
  it.each([
    ['a block comment', ['%%', block(), '%%'].join('\n')],
    ['a comment opened in prose', ['Draft %% not ready:', block(), 'until review %% done.'].join('\n')],
    ['an unclosed comment', ['%% draft', block()].join('\n')],
    ['a comment an escaped marker does not close', ['%% draft \\%% still hidden', block(), '%%'].join('\n')],
    ['a comment after an escaped backslash', ['Path C:\\\\%% draft', block(), '%%'].join('\n')],
  ])('ignores a plan inside %s in Markdown and Canvas text', (_name, example) => {
    const canvas = (texts: string[]) => JSON.stringify({ nodes: texts.map(text => ({ type: 'text', text })), edges: [] });
    expect(() => extractTutorial(example, 'flow.md')).toThrow('exactly one');
    expect(extractTutorial(`${block()}\n\n${example}`, 'flow.md')).toEqual(tutorialPlan(base()));
    expect(() => extractTutorial(canvas([example]), 'flow.canvas')).toThrow('exactly one');
    expect(extractTutorial(canvas([example, block()]), 'flow.canvas')).toEqual(tutorialPlan(base()));
  });
  it('keeps %% literal inside code, where it opens no comment', () => {
    const plan = { ...base(), title: 'Reach 100%% coverage' };
    expect(extractTutorial(block(plan), 'flow.md')).toEqual(tutorialPlan(plan));
    for (const prefix of [['```text', '%% literal', '```'].join('\n'), 'Type `%%` to start a comment.']) {
      expect(extractTutorial(`${prefix}\n\n${block()}`, 'flow.md')).toEqual(tutorialPlan(base()));
      expect(extractTutorial(`${prefix}\n\n%% hidden %%\n\n${block()}`, 'flow.md')).toEqual(tutorialPlan(base()));
    }
  });
  it.each(['Type \\%% to start a comment.', 'Type \\\\\\%% after a backslash.'])('keeps an escaped marker literal: %s', prefix => {
    expect(extractTutorial(`${prefix}\n\n${block()}\n\nThen %% hidden %%`, 'flow.md')).toEqual(tutorialPlan(base()));
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
  it.each(['HOME', 'GITHUB_TOKEN', 'AZURE_DEVOPS_EXT_PAT', 'FORGE_TUTORIAL_', 'forge_tutorial_name'])('rejects valueFromEnv %s outside the FORGE_TUTORIAL_ prefix', variable => {
    const fill = { type: 'fill', locator: { css: '#q' }, valueFromEnv: variable };
    expect(() => tutorialPlan({ ...base(), steps: [{ id: 'step', title: 'Step', actions: [fill] }] }))
      .toThrow(expect.objectContaining({ code: 'BROWSER_FLOW_INVALID', message: expect.stringContaining('FORGE_TUTORIAL_') }));
  });
  it('accepts explicit actions and environment references without resolving them', () => {
    const actions = [
      { type: 'goto', url: 'https://example.org/#/settings' }, { type: 'fill', locator: { label: 'Password' }, valueFromEnv: 'FORGE_TUTORIAL_PASSWORD' },
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
