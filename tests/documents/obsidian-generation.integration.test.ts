import { NodeEventScope } from '../../src/infrastructure/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import { ClaudeAgents } from '../../src/application/claude-agents.ts';
import { DataSourceLibrary } from '../../src/application/data-sources.ts';
import { EventBus } from '../../src/application/events.ts';
import { InteractionLibrary } from '../../src/application/interactions.ts';
import { UiLibrary } from '../../src/application/ui.ts';
import { Workspace } from '../../src/application/workspace.ts';
import { parseClaudeAgent, renderClaudeAgent } from '../../src/infrastructure/claude-agents.ts';
import { MarkdownDataSourceDefinitions } from '../../src/infrastructure/data-source-definitions.ts';
import { TypeScriptDataSourceRenderer } from '../../src/infrastructure/data-source-generator.ts';
import { ObsidianDocuments, encodeText, parseMarkdownParts } from '../../src/infrastructure/documents.ts';
import { NodeFiles } from '../../src/infrastructure/files.ts';
import { MarkdownInteractionDefinitions } from '../../src/infrastructure/interaction-definitions.ts';
import { MarkdownTemplates } from '../../src/infrastructure/templates.ts';
import { MarkdownUiDefinitions } from '../../src/infrastructure/ui-definitions.ts';
import { renderUiComponents } from '../../src/infrastructure/ui-renderers.ts';

let root: string, workspace: Workspace;
const documents = new ObsidianDocuments();
const prose = '\r\n# Authored notes\r\n\r\n[[Architecture#Decision|Decision]] ![[diagram.png|320]] #engineering/review\r\n\r\n> [!tip] Context\r\n> Keep [[Related note]] and $HOME literal.\r\n\r\n- [ ] Review the change ^review-task\r\n\r\n```js\r\nconst label = "[[literal]]";\r\n```\r\n\r\n$$x^2$$\r\n';
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-obsidian-generation-'));
  const events = new EventBus(new NodeEventScope());
  for (const id of ['file.created', 'file.updated']) events.define({ id, validate: (value): value is object => typeof value === 'object' });
  workspace = new Workspace(await NodeFiles.at(root), documents, events, false);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function authorNotes(path: string) {
  const before = await workspace.files.read(path);
  await workspace.edit(path, before.revision, bytes => {
    const text = decode(bytes), parts = parseMarkdownParts(text);
    const header = text.slice(0, text.length - parts.body.length).replace(/^---\r?\n/, '---\n# Retain author comment\n').replace(/\r?\n/g, '\r\n');
    return encodeText(header + prose);
  });
}
async function properties(path: string, changes: Record<string, unknown>) {
  const before = await workspace.files.read(path);
  await workspace.edit(path, before.revision, bytes => documents.properties(bytes, changes));
  const after = await workspace.files.read(path), parts = parseMarkdownParts(decode(after.bytes));
  expect(parts.body).toBe(prose);
  expect(parts.yaml).toContain('# Retain author comment');
  return after;
}

describe('generated Markdown as editable Obsidian source', () => {
  it('keeps template note property types, quoted internal links, tags and authored body through guarded edits', async () => {
    const template = encodeText('---\ntitle: {{title}}\ntags: {{tags}}\naliases: {{aliases}}\nrelated: {{related}}\ncomplete: {{complete}}\npriority: {{priority}}\ncreated: {{date}}\n---\n# {{title}}\n');
    const bytes = new MarkdownTemplates().render(template, {
      title: 'Engineering plan', date: '2026-10-07',
      values: { tags: ['engineering/review'], aliases: ['Plan'], related: '[[Architecture]]', complete: false, priority: 2 },
    });
    await workspace.write([{ path: 'notes/plan.md', bytes }]);
    await authorNotes('notes/plan.md');
    const edited = await properties('notes/plan.md', { complete: true, priority: 3, tags: ['engineering/review', 'ready'], related: '[[Architecture#Decision]]' });
    expect(documents.inspect(edited.path, edited.bytes)).toMatchObject({
      body: prose, properties: { title: 'Engineering plan', aliases: ['Plan'], complete: true, priority: 3, tags: ['engineering/review', 'ready'], related: '[[Architecture#Decision]]', created: '2026-10-07' },
    });
    expect(parseMarkdownParts(decode(edited.bytes)).yaml).toMatch(/related: ["']\[\[Architecture#Decision\]\]["']/);
  });

  it('round trips native Claude agent metadata and the authored system prompt without Obsidian wrappers', async () => {
    const agents = new ClaudeAgents(workspace, { parse: parseClaudeAgent, render: renderClaudeAgent });
    await agents.create('review', renderClaudeAgent({ metadata: { name: 'review', description: 'Review changes', tools: ['Read', 'Grep'], tags: ['agents/review'], background: false, maxTurns: 4 }, prompt: '# Review\n' }));
    const path = '.claude/agents/review.md';
    await authorNotes(path);
    await properties(path, { tools: ['Read', 'Grep', 'Glob'], maxTurns: 8, background: true, tags: ['agents/review', 'ready'] });
    const edited = await agents.inspect('review');
    expect(edited.prompt).toBe(prose);
    expect(edited.metadata).toMatchObject({ tools: ['Read', 'Grep', 'Glob'], maxTurns: 8, background: true, tags: ['agents/review', 'ready'] });
    expect(parseClaudeAgent(renderClaudeAgent(edited))).toEqual({ metadata: edited.metadata, prompt: prose });
  });

  it('regenerates executable UI from source-mode component and interaction edits while retaining their note bodies', async () => {
    const interactions = new InteractionLibrary(workspace, new MarkdownInteractionDefinitions());
    const components = new UiLibrary(workspace, new MarkdownUiDefinitions(), [], {
      generate: (definitions, options) => renderUiComponents(definitions, options.framework, options.outputDirectory, options.interactions),
    }, interactions);
    await interactions.create('interactions', 'mark-reviewed');
    await components.create('components', 'review-button', 'button');
    await authorNotes('interactions/mark-reviewed.md');
    await authorNotes('components/review-button.md');
    await properties('interactions/mark-reviewed.md', { actions: [{ type: 'set-state', state: 'label', value: 'Before source edit' }] });
    await properties('components/review-button.md', {
      state: { label: { type: 'string', default: 'Review' } },
      root: { tag: 'button', attrs: { type: 'button', disabled: false }, text: '{{state.label}}', interactions: ['mark-reviewed'] },
    });
    await components.generate('components', { framework: 'vanilla', outputDirectory: 'generated' });
    const outputs = await Promise.all((await workspace.files.list()).filter(path => path.startsWith('generated/')).map(path => workspace.files.read(path)));
    expect(decode(outputs.find(output => output.path.endsWith('.js'))!.bytes)).toContain('Before source edit');
    await properties('interactions/mark-reviewed.md', { actions: [{ type: 'set-state', state: 'label', value: 'Reviewed in source' }] });
    const sources = await Promise.all(['interactions/mark-reviewed.md', 'components/review-button.md'].map(path => workspace.files.read(path)));
    await components.generate('components', { framework: 'vanilla', outputDirectory: 'generated', revisions: Object.fromEntries(outputs.map(output => [output.path, output.revision])) });
    const source = decode((await workspace.files.read('generated/review-button.js')).bytes);
    const browser = new JSDOM('<main></main>');
    try {
      const exported: { default?: () => HTMLButtonElement } = {};
      const executable = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      new Function('exports', 'document', executable)(exported, browser.window.document);
      const button = exported.default!();
      expect(button.textContent).toBe('Review');
      button.click();
      expect(button.textContent).toBe('Reviewed in source');
      expect(button.disabled).toBe(false);
    } finally { browser.window.close(); }
    for (const original of sources) expect(await workspace.files.read(original.path)).toEqual(original);
    expect((await components.inspect('components', 'review-button')).description).toBe(prose);
    expect((await interactions.inspect('interactions', 'mark-reviewed')).description).toBe(prose);
  });

  it('regenerates typed data fixtures from YAML edits without interpreting linked Markdown as model configuration', async () => {
    const sources = new DataSourceLibrary(workspace, new MarkdownDataSourceDefinitions(), new TypeScriptDataSourceRenderer());
    await sources.create('sources', 'work-items', 'json');
    const path = 'sources/work-items.md';
    await authorNotes(path);
    const record = { id: 'item-1', title: '[[Plan]] #engineering', complete: false, priority: 2, note: null };
    const source = await properties(path, {
      model: { name: 'WorkItem', idField: 'id', fields: { id: { type: 'string' }, title: { type: 'string' }, complete: { type: 'boolean' }, priority: { type: 'number' }, note: { type: 'string', nullable: true } } },
      testData: { records: [record] },
    });
    await sources.generate('sources', { outputDirectory: 'adapters', testDataDirectory: 'fixtures' });
    const generated = await workspace.files.read('fixtures/work-items.fixtures.json');
    expect(JSON.parse(decode(generated.bytes))).toEqual([record]);
    const model = decode((await workspace.files.read('adapters/work-items.ts')).bytes);
    expect(model).toContain('"complete": boolean');
    expect(model).toContain('"priority": number');
    expect(model).toContain('"note": string | null');
    expect((await sources.inspect('sources', 'work-items')).description).toBe(prose);
    expect(await workspace.files.read(path)).toEqual(source);
  });
});
