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
import { componentScaffold, projectScaffold } from '../../src/plugins/scaffolds/infrastructure/projects.ts';
import { commands } from '../../src/presentation/cli/commands.ts';
import { claudeBytes, claudeInput } from '../../src/plugins/claude/presentation/input.ts';
import { ScopedFiles } from '../../src/application/workspace/scoped-files.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';

let root: string, registry: Registry, context: CommandContext, events: EventBus;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-commands-'));
  const files = await NodeFiles.at(root);
  events = new EventBus(new NodeEventScope());
  events.define({ id: 'vault.modify', validate: (value): value is object => typeof value === 'object' });
  events.define({ id: 'vault.create', validate: (value): value is object => typeof value === 'object' });
  const workspace = new Workspace(files, new ObsidianDocuments(), events, false);
  context = { workspace, events, root, workspaceRoot: root, project: null, ...scopeServices(workspace, events), input: async () => new Uint8Array() };
  registry = new Registry(skillFrontmatter);
  const loaded = await loadConfig({ defaultPath: join(root, 'bin/config.json'), cwd: root });
  for (const command of commands(registry, {
    loaded, files,
    projects: new ProjectService(files, workspace, 'projects', () => ({ project: projectScaffold, component: componentScaffold }), events),
    get workflows(): never { throw new Error('Document commands must not access workflows'); },
    setup: async () => undefined,
    configSections: () => registry.settings.sections(),
    installedPlugins: async () => [],
  })) registry.add(registry.commands, command);
});

describe('extracted command boundaries', () => {
  it('retains command discovery order and discovers contributions registered after assembly', async () => {
    expect([...registry.commands.keys()]).toEqual(['config', 'setup', 'project', 'workflows',
      'help', 'schema', 'formats', 'list', 'read', 'validate', 'create', 'write', 'edit', 'properties', 'patch', 'apply', 'delete', 'move', 'rename', 'make', 'events', 'plugins']);
    registry.add(registry.generators, { id: 'custom.fixture', description: 'Late generator', generate: () => [] });
    registry.add(registry.commands, { id: 'custom.run', description: 'Late command', usage: 'custom.run', run: () => null });
    const schema = await registry.commands.get('schema')!.run([], {}, context);
    expect(schema).toMatchObject({ commands: expect.arrayContaining([expect.objectContaining({ id: 'custom.run', description: 'Late command', usage: 'custom.run', options: {}, args: [], errors: [],
      annotations: { scope: 'project', discovery: false, mutating: true, readOnlyHint: false, destructiveHint: true, idempotentHint: false } })]),
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

  it('routes make to any generator with its own options, defaults and the shared review service', async () => {
    let received: unknown;
    registry.add(registry.generators, {
      id: 'custom.note', description: 'Note', directory: 'notes', review: true,
      options: { title: { type: 'string', description: 'Heading' } },
      generate({ name, directory, flags }) { received = flags; return [{ path: `${directory}/${name}.md`, bytes: new TextEncoder().encode(`# ${String(flags.title ?? name)}\n`) }]; },
    });
    const make = registry.commands.get('make')!;
    expect(make.options).toBeUndefined();
    expect(make.actions!['custom.note']!.options).toMatchObject({ title: { type: 'string' }, plan: { type: 'boolean' }, out: { type: 'string' } });
    expect(await make.run(['custom.note', 'Plan'], { plan: true }, context)).toMatchObject({ generator: 'custom.note', plan: true, matches: false, outputs: [{ path: 'notes/Plan.md', status: 'missing' }] });
    expect(await make.run(['custom.note', 'Plan'], { title: 'Roadmap' }, context)).toMatchObject({ generator: 'custom.note', changes: [{ path: 'notes/Plan.md', operation: 'created' }] });
    expect(received).toEqual({ title: 'Roadmap' });
    await expect(make.run(['custom.note', 'Plan'], { check: true }, context)).rejects.toMatchObject({ code: 'GENERATION_DRIFT' });
    expect(await make.run(['custom.note', 'Plan'], { check: true, title: 'Roadmap' }, context)).toMatchObject({ check: true, matches: true });
    await expect(make.run(['custom.note', 'Plan'], { template: 'x.md' }, context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('--template is not supported by make custom.note') });
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
