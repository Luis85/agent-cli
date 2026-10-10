import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scopeServices } from '../support/metadata.ts';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/application/plugins/events.ts';
import { Registry, type CommandContext } from '../../src/application/plugins/registry.ts';
import { ProjectService } from '../../src/application/projects/projects.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { loadConfig } from '../../src/infrastructure/workspace/config.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { componentScaffold, projectScaffold } from '../../src/infrastructure/projects/scaffolds.ts';
import { MarkdownTemplates } from '../../src/infrastructure/templates/markdown.ts';
import { commands } from '../../src/presentation/cli/commands.ts';
import { claudeBytes, claudeInput } from '../../src/presentation/claude/input.ts';
import { ScopedFiles } from '../../src/application/workspace/scoped-files.ts';

let root: string, registry: Registry, context: CommandContext, events: EventBus;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-commands-'));
  const files = await NodeFiles.at(root);
  events = new EventBus(new NodeEventScope());
  events.define({ id: 'vault.modify', validate: (value): value is object => typeof value === 'object' });
  events.define({ id: 'vault.create', validate: (value): value is object => typeof value === 'object' });
  const workspace = new Workspace(files, new ObsidianDocuments(), events, false);
  context = { workspace, events, root, workspaceRoot: root, project: null, claude: { execute: async () => { throw new Error('Unexpected Claude invocation'); } }, ...scopeServices(workspace, events), input: async () => new Uint8Array() };
  registry = new Registry();
  const loaded = await loadConfig({ defaultPath: join(root, 'bin/config.json'), cwd: root });
  for (const command of commands(registry, {
    loaded, files, templates: new MarkdownTemplates(),
    projects: new ProjectService(files, workspace, 'projects', { project: projectScaffold, component: componentScaffold }, events),
    get uiLibrary(): never { throw new Error('Document commands must not access UI library'); },
    get dataSources(): never { throw new Error('Document commands must not access data sources'); },
    get interactions(): never { throw new Error('Document commands must not access interactions'); },
    get workflows(): never { throw new Error('Document commands must not access workflows'); },
    async installTemplates() { throw new Error('Document commands must not install templates'); },
    setup: async () => undefined,
  })) registry.add(registry.commands, command);
});

describe('extracted command boundaries', () => {
  it('retains command discovery order and discovers contributions registered after assembly', async () => {
    expect([...registry.commands.keys()]).toEqual(['config', 'setup', 'templates', 'project', 'components', 'data-sources', 'interactions', 'workflows',
      'help', 'schema', 'formats', 'list', 'read', 'validate', 'create', 'write', 'edit', 'properties', 'patch', 'delete', 'move', 'rename', 'make', 'events', 'plugins', 'skills']);
    registry.add(registry.generators, { id: 'custom.fixture', description: 'Late generator', generate: () => [] });
    registry.add(registry.commands, { id: 'custom.run', description: 'Late command', usage: 'custom.run', run: () => null });
    const schema = await registry.commands.get('schema')!.run([], {}, context);
    expect(schema).toMatchObject({ commands: expect.arrayContaining([{ id: 'custom.run', description: 'Late command', usage: 'custom.run', options: {} }]),
      generators: expect.arrayContaining([{ id: 'custom.fixture', description: 'Late generator' }]) });
    expect(await registry.commands.get('make')!.run([], {}, context)).toMatchObject({ generators: expect.arrayContaining([{ id: 'custom.fixture', description: 'Late generator' }]) });
  });

  it.each([
    ['Empty.md', ''],
    ['Empty.canvas', '{"nodes":[],"edges":[]}\n'],
    ['Empty.base', 'views:\n  - type: table\n    name: Table\n'],
  ])('preserves the exact native default source for %s', async (path, source) => {
    await registry.commands.get('create')!.run([path], {}, context);
    expect(await readFile(join(root, path), 'utf8')).toBe(source);
    expect(events.history).toMatchObject([{ id: 'vault.create', payload: { path } }]);
  });

  it('shares raw input selection within the selected workspace without decoding binary attachments', async () => {
    await mkdir(join(root, 'selected'));
    await writeFile(join(root, 'input.bin'), 'workspace input');
    const binary = new Uint8Array([0, 255, 128, 10]);
    await writeFile(join(root, 'selected/input.bin'), binary);
    const workspace = context.workspace.within(new ScopedFiles(context.workspace.files, 'selected'), null);
    const selected = { ...context, workspace };
    expect(await claudeBytes({ from: 'input.bin' }, selected)).toEqual(Buffer.from(binary));
    await expect(claudeInput({ from: 'input.bin' }, selected)).rejects.toThrow();
    await registry.commands.get('write')!.run(['copied.bin'], { from: 'input.bin' }, selected);
    expect(await readFile(join(root, 'selected/copied.bin'))).toEqual(Buffer.from(binary));
    await expect(readFile(join(root, 'copied.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps source selection errors specific to each command family and supports empty inline text', async () => {
    await expect(claudeBytes({ content: '', stdin: true }, context)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Supply exactly one of --from <native-file>, --content <text>, or --stdin.' });
    await expect(registry.commands.get('write')!.run(['note.md'], { content: '', stdin: true }, context)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Choose exactly one of --content, --from, or --stdin.' });
    expect(await claudeBytes({ content: '' }, context)).toEqual(new Uint8Array());
    await registry.commands.get('write')!.run(['empty.md'], { content: '' }, context);
    expect(await readFile(join(root, 'empty.md'), 'utf8')).toBe('');
    expect(await claudeBytes({ stdin: true }, { ...context, input: async () => new Uint8Array([255, 0]) })).toEqual(new Uint8Array([255, 0]));
  });

  it('keeps base64 decoding exclusive to document input', async () => {
    await registry.commands.get('write')!.run(['binary.bin'], { content: 'AP+A', encoding: 'base64' }, context);
    expect(await readFile(join(root, 'binary.bin'))).toEqual(Buffer.from([0, 255, 128]));
    expect(await claudeInput({ content: 'AP+A' }, context)).toBe('AP+A');
    await expect(registry.commands.get('write')!.run(['bad.bin'], { content: '%', encoding: 'base64' }, context)).rejects.toMatchObject({ code: 'INVALID_ENCODING' });
  });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('literal Markdown editing contract', () => {
  it.each([false, true])('refuses overlapping matches without changing files or emitting events (dry run: %s)', async dryRun => {
    await writeFile(join(root, 'note.md'), 'banana');
    const snapshot = await context.workspace.files.read('note.md');
    const workspace = new Workspace(context.workspace.files, context.workspace.codec, events, dryRun);
    await expect(registry.commands.get('edit')!.run(['note.md'], {
      find: 'ana', replace: 'other', 'if-match': snapshot.revision,
    }, { ...context, workspace })).rejects.toMatchObject({ code: 'AMBIGUOUS_EDIT', details: { matches: 2, lines: [1, 1] } });
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('banana');
    expect(events.history).toEqual([]);
  });

  it('replaces a unique multi-character match with literal replacement text', async () => {
    await writeFile(join(root, 'note.md'), 'A banana.');
    const snapshot = await context.workspace.files.read('note.md');
    await registry.commands.get('edit')!.run(['note.md'], {
      find: 'banana', replace: '$& fruit', 'if-match': snapshot.revision,
    }, context);
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('A $& fruit.');
    expect(events.history).toHaveLength(1);
  });
});
