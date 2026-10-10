import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metadataIndex } from '../support/metadata.ts';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { ClaudeSettings } from '../../src/application/claude/settings.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { ScopedFiles } from '../../src/application/workspace/scoped-files.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { claudeTarget } from '../../src/infrastructure/claude/target.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';

let root: string, context: CommandContext, events: EventBus;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-claude-target-'));
  events = new EventBus(new NodeEventScope());
  events.define({ id: 'vault.create', validate: (value): value is object => typeof value === 'object' });
  const workspace = new Workspace(await NodeFiles.at(root), new ObsidianDocuments(), events, false);
  context = { root, workspaceRoot: root, workspace, events, project: null, claude: { execute: async () => { throw new Error('Unexpected Claude invocation'); } }, metadata: metadataIndex(workspace.files), input: async () => new Uint8Array() };
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe('explicit native Claude targets', () => {
  it('resolves project, local and plugin paths without creating files', async () => {
    expect(await claudeTarget(context, {})).toMatchObject({ scope: 'project', directory: join(root, '.claude'), agentsDirectory: '.claude/agents', settingsPath: '.claude/settings.json' });
    expect(await claudeTarget(context, { scope: 'local' })).toMatchObject({ scope: 'local', settingsPath: '.claude/settings.local.json' });
    expect(await claudeTarget(context, { scope: 'plugin', directory: 'plugins/team' })).toMatchObject({
      scope: 'plugin', directory: join(root, 'plugins/team'), agentsDirectory: 'plugins/team/agents', settingsPath: 'plugins/team/hooks/hooks.json',
    });
    expect(await readdir(root)).toEqual([]);
  });

  it('uses the selected project repository for project/local/plugin writes instead of the workspace root', async () => {
    await mkdir(join(root, 'projects/selected'), { recursive: true });
    const selected: CommandContext = { ...context, root: join(root, 'projects/selected'),
      project: { schemaVersion: 1, name: 'selected', type: 'library', directory: 'projects/selected' },
      workspace: context.workspace.within(new ScopedFiles(context.workspace.files, 'projects/selected'), null) };
    const scopes: Record<string, string | boolean>[] = [{}, { scope: 'local' }, { scope: 'plugin', directory: 'plugins/team' }];
    for (const flags of scopes) {
      const target = await claudeTarget(selected, flags);
      await new ClaudeSettings(target.workspace, target.settingsPath).set({});
      expect(JSON.parse(await readFile(join(selected.root, target.settingsPath), 'utf8'))).toEqual({ hooks: {} });
      await expect(readFile(join(root, target.settingsPath))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('previews missing user configuration descendants without making any directory', async () => {
    const directory = join(root, 'missing-parent/custom-claude');
    const preview = { ...context, workspace: new Workspace(context.workspace.files, context.workspace.codec, events, true) };
    const target = await claudeTarget(preview, { scope: 'user', 'claude-dir': directory });
    expect(target).toMatchObject({ scope: 'user', directory, agentsDirectory: 'agents', settingsPath: 'settings.json' });
    const result = await new ClaudeSettings(target.workspace, target.settingsPath).set({});
    expect(result.dryRun).toBe(true);
    expect(await readdir(root)).toEqual([]);
    expect(events.history).toEqual([]);
  });

  it('keeps first-write previews and subsequent inspections relative to the explicit user directory', async () => {
    const directory = join(root, 'missing/user-config');
    const first = await claudeTarget(context, { scope: 'user', 'claude-dir': directory });
    const created = await new ClaudeSettings(first.workspace, first.settingsPath).set({});
    expect(created).toMatchObject({ path: 'settings.json', changes: [{ path: 'settings.json', operation: 'created' }] });
    const next = await claudeTarget(context, { scope: 'user', 'claude-dir': directory });
    const inspected = await new ClaudeSettings(next.workspace, next.settingsPath).inspect();
    expect(inspected.path).toBe(created.path);
    expect(inspected.revision).toBe(created.changes[0]!.revision);
    expect(JSON.parse(await readFile(join(directory, created.path), 'utf8'))).toEqual({ hooks: {} });
  });

  it('keeps an explicit user override separate from active project context and the config environment', async () => {
    await mkdir(join(root, 'selected'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'environment-claude'));
    const selected = { ...context, root: join(root, 'selected') };
    const directory = join(root, 'explicit-claude');
    const target = await claudeTarget(selected, { scope: 'user', 'claude-dir': directory });
    await new ClaudeSettings(target.workspace, target.settingsPath).set({});
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))).toEqual({ hooks: {} });
    expect(await readdir(join(root, 'selected'))).toEqual([]);
    await expect(readFile(join(root, 'environment-claude/settings.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await claudeTarget(context, { scope: 'user' })).directory).toBe(join(root, 'environment-claude'));
  });

  it('rejects contradictory scopes, unsafe plugin paths and invalid user locations', async () => {
    const scopes: Record<string, string | boolean>[] = [{ scope: 'managed' }, { 'claude-dir': '/unused' }, { directory: 'plugins/team' }, { scope: 'plugin' }, { scope: 'plugin', directory: '../outside' }, { scope: 'user', 'claude-dir': '' }];
    for (const flags of scopes) {
      await expect(claudeTarget(context, flags)).rejects.toMatchObject({ code: expect.stringMatching(/^INVALID_/) });
    }
    await writeFile(join(root, 'a-file'), 'keep');
    await expect(claudeTarget(context, { scope: 'user', 'claude-dir': join(root, 'a-file') })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(await readdir(root)).toEqual(['a-file']);
  });

  it('resolves an explicit relative user directory from the selected context instead of shell cwd', async () => {
    await mkdir(join(root, 'selected'));
    const target = await claudeTarget({ ...context, root: join(root, 'selected') }, { scope: 'user', 'claude-dir': 'custom-claude' });
    expect(target.directory).toBe(join(root, 'selected/custom-claude'));
    expect(await readdir(join(root, 'selected'))).toEqual([]);
  });

  it('retains committed user-setting changes and reports repository cleanup warnings', async () => {
    const directory = join(root, 'user-config');
    await mkdir(directory);
    const target = await claudeTarget(context, { scope: 'user', 'claude-dir': directory });
    const adapter = target.workspace.files as unknown as { releaseLock(path: string): Promise<void> };
    vi.spyOn(adapter, 'releaseLock').mockRejectedValueOnce(new Error('Cleanup failed'));
    const result = await new ClaudeSettings(target.workspace, target.settingsPath).set({});
    expect(result.changes).toMatchObject([{ operation: 'created' }]);
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))).toEqual({ hooks: {} });
    expect(events.warnings).toEqual([expect.stringContaining('Cleanup failed')]);
  });
});
