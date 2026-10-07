import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../src/application/events.ts';
import { Registry, type CommandContext } from '../src/application/plugins.ts';
import { ProjectService } from '../src/application/projects.ts';
import { Workspace } from '../src/application/workspace.ts';
import { loadConfig } from '../src/infrastructure/config.ts';
import { ObsidianDocuments } from '../src/infrastructure/documents.ts';
import { NodeFiles } from '../src/infrastructure/files.ts';
import { componentScaffold, projectScaffold } from '../src/infrastructure/project-scaffolds.ts';
import { MarkdownTemplates } from '../src/infrastructure/templates.ts';
import { commands } from '../src/presentation/commands.ts';

let root: string, registry: Registry, context: CommandContext;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-commands-'));
  const files = await NodeFiles.at(root), events = new EventBus();
  events.define({ id: 'file.updated', validate: (value): value is object => typeof value === 'object' });
  const workspace = new Workspace(files, new ObsidianDocuments(), events, false);
  context = { workspace, events, root, workspaceRoot: root, project: null, input: async () => new Uint8Array() };
  registry = new Registry();
  const loaded = await loadConfig({ defaultPath: join(root, 'bin/config.json'), cwd: root });
  for (const command of commands(registry, {
    loaded, files, templates: new MarkdownTemplates(),
    projects: new ProjectService(files, workspace, 'projects', { project: projectScaffold, component: componentScaffold }),
    setup: async () => undefined,
  })) registry.add(registry.commands, command);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('literal Markdown editing contract', () => {
  it.each([false, true])('refuses overlapping matches without changing files or emitting events (dry run: %s)', async dryRun => {
    await writeFile(join(root, 'note.md'), 'banana');
    const snapshot = await context.workspace.files.read('note.md');
    const workspace = new Workspace(context.workspace.files, context.workspace.codec, context.events, dryRun);
    await expect(registry.commands.get('edit')!.run(['note.md'], {
      find: 'ana', replace: 'other', 'if-match': snapshot.revision,
    }, { ...context, workspace })).rejects.toMatchObject({ code: 'AMBIGUOUS_EDIT' });
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('banana');
    expect(context.events.history).toEqual([]);
  });

  it('replaces a unique multi-character match with literal replacement text', async () => {
    await writeFile(join(root, 'note.md'), 'A banana.');
    const snapshot = await context.workspace.files.read('note.md');
    await registry.commands.get('edit')!.run(['note.md'], {
      find: 'banana', replace: '$& fruit', 'if-match': snapshot.revision,
    }, context);
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('A $& fruit.');
    expect(context.events.history).toHaveLength(1);
  });
});
