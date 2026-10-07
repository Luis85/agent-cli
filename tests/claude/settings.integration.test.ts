import { NodeEventScope } from '../../src/infrastructure/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeSettings } from '../../src/application/claude-settings.ts';
import { EventBus } from '../../src/application/events.ts';
import { Workspace } from '../../src/application/workspace.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents.ts';
import { NodeFiles } from '../../src/infrastructure/files.ts';

let root: string, files: NodeFiles, events: EventBus;
const path = '.claude/settings.json';
const first = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo first', future: 'preserved' }] };
const second = { matcher: 'Read', hooks: [{ type: 'command', command: 'echo second' }] };
const other = { model: 'sonnet', permissions: { allow: ['Read'], deny: ['Bash(rm *)'] }, future: { nested: [1, null] } };
const service = (dryRun = false, plugin = false) => new ClaudeSettings(new Workspace(files, new ObsidianDocuments(), events, dryRun), path, plugin);
async function seed(settings: unknown) {
  await mkdir(join(root, '.claude'), { recursive: true });
  await writeFile(join(root, path), JSON.stringify(settings));
  return (await files.read(path)).revision;
}
const saved = async () => JSON.parse(await readFile(join(root, path), 'utf8'));
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-claude-settings-'));
  files = await NodeFiles.at(root);
  events = new EventBus(new NodeEventScope());
  for (const id of ['file.created', 'file.updated']) events.define({ id, validate: (value): value is object => typeof value === 'object' });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('guarded Claude settings updates', () => {
  it('sets, appends and removes requested hook groups while preserving unrelated settings and events', async () => {
    let revision = await seed(other);
    await service().set({ PreToolUse: [first] }, revision);
    expect(await saved()).toEqual({ ...other, hooks: { PreToolUse: [first] } });
    revision = (await service().inspect()).revision!;
    await service().add('PreToolUse', second, revision);
    revision = (await service().inspect()).revision!;
    await service().add('PostToolUse', second, revision);
    revision = (await service().inspect()).revision!;
    await service().remove('PreToolUse', revision, 0);
    expect(await saved()).toEqual({ ...other, hooks: { PreToolUse: [second], PostToolUse: [second] } });
    revision = (await service().inspect()).revision!;
    await service().remove('PreToolUse', revision, 0);
    revision = (await service().inspect()).revision!;
    await service().remove('PostToolUse', revision);
    expect(await saved()).toEqual({ ...other, hooks: {} });
    expect(events.history.map(entry => entry.id)).toEqual(Array(6).fill('file.updated'));
  });

  it('toggles global hook execution without deleting handlers or unrelated flags', async () => {
    const revision = await seed({ ...other, hooks: { PreToolUse: [first] } });
    await service().toggle(false, revision);
    expect(await saved()).toEqual({ ...other, hooks: { PreToolUse: [first] }, disableAllHooks: true });
    await service().toggle(true, (await service().inspect()).revision!);
    expect(await saved()).toEqual({ ...other, hooks: { PreToolUse: [first] }, disableAllHooks: false });
  });

  it('requires a current revision for existing settings and rejects stale writes even in previews', async () => {
    const revision = await seed(other);
    const before = await files.read(path);
    for (const dryRun of [false, true]) {
      await expect(service(dryRun).set({})).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(service(dryRun).add('PreToolUse', first, 'stale')).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(service(dryRun).toggle(false, 'stale')).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    expect(await files.read(path)).toEqual(before);
    expect(events.history).toEqual([]);
    await service().set({}, revision);
    await expect(service().set({ PreToolUse: [first] }, revision)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('previews new and existing settings without creating directories, changing bytes or emitting events', async () => {
    expect(await service(true).inspect()).toMatchObject({ revision: null, hooks: {}, settings: {} });
    const created = await service(true).set({ PreToolUse: [first] });
    expect(created).toMatchObject({ dryRun: true, preview: [{ path, content: expect.any(String) }] });
    expect(await readdir(root)).toEqual([]);
    const revision = await seed({ ...other, hooks: { PreToolUse: [first] } });
    const before = await files.read(path);
    await service(true).remove('PreToolUse', revision);
    await service(true).toggle(false, revision);
    await service(true).agentEnabled('reviewer', false, revision);
    expect(await files.read(path)).toEqual(before);
    expect(events.history).toEqual([]);
  });

  it('allows explicit replacement of malformed hook data but blocks incremental edits until repaired', async () => {
    const revision = await seed({ ...other, hooks: null });
    expect((await service().inspect()).hooks).toBeNull();
    await expect(service().validate()).rejects.toMatchObject({ code: 'INVALID_CLAUDE_HOOKS' });
    await expect(service().add('PreToolUse', first, revision)).rejects.toMatchObject({ code: 'INVALID_CLAUDE_HOOKS' });
    await service().set({ PreToolUse: [first] }, revision);
    expect(await saved()).toEqual({ ...other, hooks: { PreToolUse: [first] } });
  });

  it.each(['{broken', 'null', '[]', '42'])('reports malformed settings %j without overwriting them', async content => {
    await seed({});
    await writeFile(join(root, path), content);
    await expect(service().inspect()).rejects.toMatchObject({ code: 'INVALID_CLAUDE_SETTINGS' });
    await expect(service().set({}, (await files.read(path)).revision)).rejects.toMatchObject({ code: 'INVALID_CLAUDE_SETTINGS' });
    expect(await readFile(join(root, path), 'utf8')).toBe(content);
    expect(events.history).toEqual([]);
  });

  it('reports invalid UTF-8 and invalid removal indices without mutation', async () => {
    await seed({});
    await writeFile(join(root, path), new Uint8Array([0xff]));
    await expect(service().inspect()).rejects.toMatchObject({ code: 'INVALID_CLAUDE_SETTINGS' });
    const revision = await seed({ hooks: { PreToolUse: [first] } });
    for (const index of [-1, 1, NaN, 0.5]) await expect(service().remove('PreToolUse', revision, index)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service().remove('Stop', revision)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await service().inspect()).revision).toBe(revision);
  });

  it('disables only the named agent and enabling preserves all other deny and allow rules', async () => {
    const permissions = { allow: ['Read'], ask: ['Bash'], deny: ['Bash(rm *)', 'Agent(other)', 'Agent(*)', 'Agent(other)'] };
    await seed({ ...other, permissions });
    await service().agentEnabled('reviewer', false, (await service().inspect()).revision!);
    let current = await saved();
    expect(current.permissions).toEqual({ ...permissions, deny: [...permissions.deny, 'Agent(reviewer)'] });
    await service().agentEnabled('reviewer', false, (await service().inspect()).revision!);
    expect((await saved()).permissions.deny.filter((rule: string) => rule === 'Agent(reviewer)')).toHaveLength(1);
    const result = await service().agentEnabled('reviewer', true, (await service().inspect()).revision!);
    current = await saved();
    expect(current).toEqual({ ...other, permissions });
    expect(result).toMatchObject({ rule: 'Agent(reviewer)', enabled: true, note: expect.stringContaining('Other permission rules') });
  });

  it.each([null, { deny: null }, { deny: [42] }, []])('rejects malformed permissions %j instead of replacing authored data', async permissions => {
    const revision = await seed({ ...other, permissions });
    await expect(service().agentEnabled('reviewer', false, revision)).rejects.toMatchObject({ code: 'INVALID_CLAUDE_SETTINGS' });
    expect((await service().inspect()).revision).toBe(revision);
  });

  it('rejects permission syntax injection and plugin-wide toggle operations', async () => {
    for (const name of ['reviewer)', '*', '(all)']) await expect(service().agentEnabled(name, false)).rejects.toMatchObject({ code: 'INVALID_CLAUDE_AGENT' });
    await expect(service(false, true).toggle(false)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service(false, true).agentEnabled('reviewer', false)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await readdir(root)).toEqual([]);
  });

  it('configures only supported hook policy settings while preserving unrelated data and handlers', async () => {
    const initial = { ...other, hooks: { PreToolUse: [first] }, disableAllHooks: false, allowedHttpHookUrls: ['https://existing.example/*'] };
    const revision = await seed(initial);
    const changes = { allowManagedHooksOnly: true, allowedHttpHookUrls: ['https://hooks.example/*'], httpHookAllowedEnvVars: ['TOKEN'] };
    const preview = await service(true).configure(changes, revision);
    expect(preview.dryRun).toBe(true);
    expect(await saved()).toEqual(initial);
    expect(events.history).toEqual([]);
    await expect(service().configure(changes)).rejects.toMatchObject({ code: 'CONFLICT' });
    await service().configure(changes, revision);
    expect(await saved()).toEqual({ ...initial, ...changes });
    expect((await service().validate()).valid).toBe(true);
    await expect(service().configure({ disableAllHooks: true }, revision)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it.each([
    { disableAllHooks: 'yes' }, { allowManagedHooksOnly: null }, { allowedHttpHookUrls: 'https://example.com' },
    { httpHookAllowedEnvVars: [1] }, { model: 'opus' }, null, [],
  ])('rejects malformed or unrelated hook policy changes %j', async changes => {
    await expect(service().configure(changes)).rejects.toMatchObject({ code: 'INVALID_CLAUDE_SETTINGS' });
    expect(await readdir(root)).toEqual([]);
  });

  it('validates existing hook policy types and permits explicit repair without losing other settings', async () => {
    const revision = await seed({ ...other, hooks: {}, disableAllHooks: 'broken' });
    await expect(service().validate()).rejects.toMatchObject({ code: 'INVALID_CLAUDE_SETTINGS' });
    await service().configure({ disableAllHooks: false }, revision);
    expect(await saved()).toEqual({ ...other, hooks: {}, disableAllHooks: false });
    await expect(service(false, true).configure({ disableAllHooks: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
