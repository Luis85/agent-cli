import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudePluginService } from '../../src/application/claude-plugins.ts';
import { EventBus } from '../../src/application/events.ts';
import { Workspace } from '../../src/application/workspace.ts';
import { parseClaudeAgent, renderClaudeAgent } from '../../src/infrastructure/claude-agents.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents.ts';
import { NodeFiles } from '../../src/infrastructure/files.ts';

let root: string, files: NodeFiles, events: EventBus;
const directory = 'claude-plugins/review-kit';
const manifest = { name: 'review-kit', version: 'rolling', metadata: { owner: 'team' }, future: { preserve: true } };
const encode = (value: string) => new TextEncoder().encode(value);
const encodeJson = (value: unknown) => encode(JSON.stringify(value));
const service = (dryRun = false) => new ClaudePluginService(new Workspace(files, new ObsidianDocuments(), events, dryRun), { parse: parseClaudeAgent, render: renderClaudeAgent });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-claude-plugin-'));
  files = await NodeFiles.at(root);
  events = new EventBus();
  for (const id of ['file.created', 'file.updated', 'file.deleted']) events.define({ id, validate: (value): value is object => typeof value === 'object' });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('native Claude plugin assets', () => {
  it('creates only a manifest, preserves fields, and requires current revisions for replacement', async () => {
    const plugins = service();
    await plugins.create(directory, manifest);
    expect(await files.list()).toEqual([`${directory}/.claude-plugin/plugin.json`]);
    const before = await plugins.inspect(directory);
    expect(before).toMatchObject({ directory, manifest, files: ['.claude-plugin/plugin.json'] });
    await plugins.update(directory, { ...manifest, description: 'Review changes' }, before.revision!);
    await expect(plugins.update(directory, manifest, before.revision!)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(plugins.create(directory, manifest)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(events.history.map(event => event.id)).toEqual(['file.created', 'file.updated']);
  });

  it('previews manifests and assets without writing or emitting events', async () => {
    const preview = await service(true).create(directory, manifest);
    expect(preview.preview?.[0]?.content).toContain('review-kit');
    expect(await readdir(root)).toEqual([]);
    expect(events.history).toEqual([]);
    await service().create(directory, manifest);
    events.history.length = 0;
    await service(true).writeAsset(directory, 'scripts/review.js', encode('throw new Error("must not execute");'));
    expect(await files.list()).toHaveLength(1);
    expect(events.history).toEqual([]);
  });

  it('round-trips text and binary assets without executing scripts', async () => {
    const plugins = service();
    await plugins.create(directory, manifest);
    const script = 'throw new Error("not executable by Forge");\r\n';
    await plugins.writeAsset(directory, 'scripts/review.mjs', encode(script));
    expect(await plugins.asset(directory, 'scripts/review.mjs')).toMatchObject({ content: script });
    const bytes = Uint8Array.from([0, 255, 127, 128]);
    await plugins.writeAsset(directory, 'assets/image.png', bytes);
    const image = await plugins.asset(directory, 'assets/image.png');
    expect(image).not.toHaveProperty('content');
    expect(image.document).toMatchObject({ encoding: 'base64', content: Buffer.from(bytes).toString('base64') });
    expect(await plugins.validate(directory)).toMatchObject({ valid: true, validation: 'structure' });
  });

  it('replaces and removes assets through revision guards with deletion events', async () => {
    const plugins = service();
    await plugins.create(directory, manifest);
    await plugins.writeAsset(directory, 'skills/review/SKILL.md', encode('# Review'));
    const before = await plugins.asset(directory, 'skills/review/SKILL.md');
    await expect(plugins.writeAsset(directory, 'skills/review/SKILL.md', encode('# Changed'))).rejects.toMatchObject({ code: 'CONFLICT' });
    await plugins.writeAsset(directory, 'skills/review/SKILL.md', encode('# Changed'), before.revision);
    await expect(plugins.removeAsset(directory, 'skills/review/SKILL.md', before.revision)).rejects.toMatchObject({ code: 'CONFLICT' });
    const current = await plugins.asset(directory, 'skills/review/SKILL.md');
    await service(true).removeAsset(directory, 'skills/review/SKILL.md', current.revision);
    expect(await plugins.asset(directory, 'skills/review/SKILL.md')).toMatchObject({ content: '# Changed' });
    await plugins.removeAsset(directory, 'skills/review/SKILL.md', current.revision);
    expect(events.history.at(-1)?.id).toBe('file.deleted');
    await expect(plugins.asset(directory, 'skills/review/SKILL.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('checks default and declared agent metadata and warns about ignored plugin fields', async () => {
    const plugins = service();
    await plugins.create(directory, { ...manifest, agents: ['./reviewers/security.md'] });
    const source = '---\nname: reviewer\ndescription: Review changes\npermissionMode: plan\nmemory: project\n---\nReview the changes.\n';
    await plugins.writeAsset(directory, 'reviewers/security.md', encode(source));
    await expect(plugins.writeAsset(directory, 'agents/invalid.md', encode('No frontmatter'))).rejects.toMatchObject({ code: 'INVALID_CLAUDE_AGENT' });
    const result = await plugins.validate(directory);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([expect.objectContaining({ path: 'reviewers/security.md', severity: 'warning', message: expect.stringContaining('permissionMode') })]);
  });

  it('validates inline and file-based hook/MCP/LSP/settings configurations', async () => {
    const plugins = service();
    await plugins.create(directory, { ...manifest, hooks: './config/hooks.json', mcpServers: './config/mcp.json', lspServers: './config/lsp.json' });
    await expect(plugins.writeAsset(directory, 'config/hooks.json', encodeJson({ Stop: [] }))).rejects.toThrow(/wrapper/);
    await plugins.writeAsset(directory, 'config/hooks.json', encodeJson({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'check' }] }] } }));
    await plugins.writeAsset(directory, 'config/mcp.json', encodeJson({ mcpServers: { local: { command: 'node', args: ['./server.js'] } } }));
    await expect(plugins.writeAsset(directory, '.mcp.json', encodeJson({ remote: { type: 'http' } }))).rejects.toThrow(/url/);
    await plugins.writeAsset(directory, 'config/lsp.json', encodeJson({ typescript: { command: 'server', extensionToLanguage: { '.ts': 'typescript' } } }));
    await plugins.writeAsset(directory, 'settings.json', encodeJson({ agent: 'reviewer', future: 1 }));
    await expect(plugins.writeAsset(directory, 'settings.json', encodeJson({ agent: false }))).rejects.toThrow(/agent/);
    expect(await plugins.validate(directory)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it('accepts hooks-module assets as data without importing them', async () => {
    const plugins = service();
    await plugins.create(directory, manifest);
    await plugins.writeAsset(directory, 'hooks/hooks.json', encodeJson({ description: 'Mod', modules: ['./register.js'] }));
    await plugins.writeAsset(directory, 'hooks/register.js', encode('throw new Error("never import me");'));
    expect(await plugins.validate(directory)).toMatchObject({ valid: true });
  });

  it('reports missing component files and invalid authored files without modifying them', async () => {
    const plugins = service();
    await plugins.create(directory, { ...manifest, agents: ['./reviewers/missing.md'], skills: './extra-skills/' });
    await mkdir(join(root, directory, 'agents'), { recursive: true });
    await writeFile(join(root, directory, 'agents/broken.md'), 'No frontmatter');
    const result = await plugins.validate(directory);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(item => item.path)).toEqual(['extra-skills', 'reviewers/missing.md', 'agents/broken.md']);
    expect(await readFile(join(root, directory, 'agents/broken.md'), 'utf8')).toBe('No frontmatter');
  });

  it('returns diagnostics for malformed manifests and permits guarded recovery', async () => {
    const plugins = service();
    await plugins.create(directory, manifest);
    await writeFile(join(root, directory, '.claude-plugin/plugin.json'), '{broken');
    const check = await plugins.validate(directory);
    expect(check).toMatchObject({ valid: false, diagnostics: [{ path: '.claude-plugin/plugin.json', severity: 'error' }] });
    const before = await plugins.asset(directory, '.claude-plugin/plugin.json');
    await plugins.update(directory, manifest, before.revision);
    expect(await plugins.validate(directory)).toMatchObject({ valid: true });
  });

  it('inspects and validates manifestless plugins without writing an inferred manifest', async () => {
    await mkdir(join(root, directory, 'skills/review'), { recursive: true });
    await writeFile(join(root, directory, 'skills/review/SKILL.md'), '# Review changes');
    const plugins = service();
    expect(await plugins.inspect(directory)).toMatchObject({ manifest: null, revision: null, inferredName: 'review-kit', files: ['skills/review/SKILL.md'] });
    expect(await plugins.validate(directory)).toMatchObject({ manifest: null, valid: true });
    await plugins.writeAsset(directory, 'commands/review.md', encode('Review the changes.'));
    expect((await plugins.inspect(directory)).manifest).toBeNull();
    await plugins.writeAsset(directory, '.claude-plugin/plugin.json', encodeJson(manifest));
    expect((await plugins.inspect(directory)).manifest).toEqual(manifest);
  });

  it('reads malformed Markdown losslessly so it can be repaired with a guarded write', async () => {
    const plugins = service();
    await plugins.create(directory, manifest);
    await mkdir(join(root, directory, 'commands'));
    const broken = '---\nname: [unterminated\n---\nReview changes';
    await writeFile(join(root, directory, 'commands/review.md'), broken);
    const before = await plugins.asset(directory, 'commands/review.md');
    expect(before).toMatchObject({ content: broken, validationError: expect.any(String) });
    await plugins.writeAsset(directory, 'commands/review.md', encode('Review changes.'), before.revision);
    expect(await plugins.asset(directory, 'commands/review.md')).not.toHaveProperty('validationError');
  });

  it('rejects traversal and symlink assets before writing outside the plugin', async () => {
    const plugins = service();
    await plugins.create(directory, manifest);
    await expect(plugins.writeAsset(directory, '../escape.js', encode('bad'))).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(plugins.writeAsset('../outside', 'file.js', encode('bad'))).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), join(root, directory, 'linked'));
    await expect(plugins.writeAsset(directory, 'linked/escape.js', encode('bad'))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await readdir(join(root, 'outside'))).toEqual([]);
  });
});
