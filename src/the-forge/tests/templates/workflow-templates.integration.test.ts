import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SetupService } from '../../src/application/workspace/setup.ts';
import { TemplateInstaller } from '../../src/application/templates/templates.ts';
import type { AppConfig } from '../../src/application/workspace/config.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { MarkdownTemplates } from '../../src/infrastructure/templates/markdown.ts';
import { workflowTemplates } from '../../src/infrastructure/templates/workflows.ts';

let root: string, files: NodeFiles, events: EventBus;
const documents = new ObsidianDocuments(), templates = new MarkdownTemplates();
const config: AppConfig = {
  schemaVersion: 1,
  paths: { projects: 'projects', components: 'components', ui: 'src/ui', stories: 'stories', componentImports: 'imports/components', componentExports: 'exports/components', dataSources: 'data-sources', dataGenerated: 'src/data-sources', dataFixtures: 'test-data', dataImports: 'imports/data-sources', dataExports: 'exports/data-sources', interactions: 'interactions', interactionImports: 'imports/interactions', interactionExports: 'exports/interactions' },
  ui: { framework: 'html' }, settings: { json: true, dryRun: false, language: 'en', events: 'changes' }, templates: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' }, plugins: { enabled: [] },
};
const workspace = (dryRun = false) => new Workspace(files, documents, events, dryRun);
const setup = (dryRun = false) => new SetupService(workspace(dryRun), config, [
  { path: 'app.js', bytes: encodeText('/* executable fixture */') },
  { path: 'package.json', bytes: encodeText('{"type":"commonjs"}') },
], [], workflowTemplates);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-workflow-')); files = await NodeFiles.at(root); events = new EventBus(new NodeEventScope());
  for (const id of ['file.created', 'file.updated']) events.define({ id, validate: (_value): _value is unknown => true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('editable idea-to-production planning templates', () => {
  it('fresh setup installs all seven discoverable templates and returns explicit next steps', async () => {
    const result = await setup().run();
    expect((await files.list()).filter(path => path.startsWith('bin/templates/workflow/'))).toHaveLength(7);
    expect(result.nextSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'workspace', command: 'node bin/app.js templates list' }),
      expect.objectContaining({ scope: 'workspace', command: 'node bin/app.js project list' }),
    ]));
    for (const artifact of workflowTemplates) {
      const bytes = (await files.read(`bin/templates/${artifact.path}`)).bytes;
      expect(templates.inspect(bytes)).toEqual({ variables: ['date:YYYY-MM-DD', 'owner', 'title'], requiredVariables: ['owner'], builtins: ['date:YYYY-MM-DD', 'title'] });
      const rendered = templates.render(bytes, { title: 'Inventory: reliable stock', date: '2026-10-07', values: { owner: "Ada's product team" } });
      expect(documents.inspect('output.md', rendered)).toMatchObject({ properties: { schemaVersion: 1, title: 'Inventory: reliable stock', owner: "Ada's product team", status: 'draft', created: '2026-10-07' } });
      const text = new TextDecoder().decode(rendered);
      expect(text).not.toContain('{{');
      expect(text).toContain('## Uncertainties and decisions');
      expect(text).toMatch(/evidence/i);
    }
  });
  it('requires an explicit owner and treats owner input as data in frontmatter and prose', () => {
    const bytes = encodeText(workflowTemplates[0]!.content);
    expect(() => templates.render(bytes, { title: 'PRD' })).toThrow(expect.objectContaining({ code: 'UNKNOWN_TEMPLATE_VARIABLE' }));
    const owner = 'team\nstatus: shipped\n---\nInjected';
    const rendered = templates.render(bytes, { title: 'PRD', date: '2026-10-07', values: { owner } });
    expect(documents.inspect('output.md', rendered)).toMatchObject({ properties: { owner, status: 'draft' } });
  });
  it('installs the standalone pack without setup and preserves customized planning sources', async () => {
    const installer = new TemplateInstaller(workspace(), workflowTemplates);
    await installer.install();
    const path = 'bin/templates/workflow/prd.md', original = await files.read(path);
    await files.writeBatch([{ path, bytes: encodeText('# Custom organizational PRD\n'), expectedRevision: original.revision }], false);
    const installed = await installer.install();
    expect(installed.changes).toEqual([]); expect(installed.skipped).toHaveLength(7);
    await setup().run();
    expect(new TextDecoder().decode((await files.read(path)).bytes)).toBe('# Custom organizational PRD\n');
  });
  it('previews standalone pack installation and setup without files or events', async () => {
    const result = await new TemplateInstaller(workspace(true), workflowTemplates).install();
    expect(result.changes).toHaveLength(7); expect(result.preview).toHaveLength(7);
    expect(result.preview?.find(file => file.path.endsWith('/test-plan.md'))?.content).toContain('Overall result: not run.');
    await setup(true).run();
    expect(await files.list()).toEqual([]); expect(events.history).toEqual([]);
  });
  it('rejects duplicate or unsafe pack paths before writing any candidate', async () => {
    await expect(new TemplateInstaller(workspace(), [workflowTemplates[0]!, workflowTemplates[0]!]).install()).rejects.toMatchObject({ code: 'INVALID_TEMPLATE_PACK' });
    await expect(new TemplateInstaller(workspace(), [workflowTemplates[0]!, { path: '../outside.md', content: 'bad' }]).install()).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(await files.list()).toEqual([]);
  });
  it('does not treat symlink access failures as missing templates', async () => {
    await symlink(tmpdir(), join(root, 'bin'));
    await expect(new TemplateInstaller(workspace(), workflowTemplates).install()).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(events.history).toEqual([]);
  });
});
