import { NodeEventScope } from '../../src/infrastructure/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgents } from '../../src/application/claude-agents.ts';
import { EventBus } from '../../src/application/events.ts';
import { Workspace } from '../../src/application/workspace.ts';
import { parseClaudeAgent, renderClaudeAgent } from '../../src/infrastructure/claude-agents.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents.ts';
import { NodeFiles } from '../../src/infrastructure/files.ts';

let root: string, files: NodeFiles, events: EventBus;
const source = '---\r\n# Authored comment\r\nname: reviewer\r\ndescription: Review changes\r\nfuture: { enabled: true }\r\n---\r\n\r\nKeep $ARGUMENTS and [[links]].\r\n';
const codec = { parse: parseClaudeAgent, render: renderClaudeAgent };
const service = (dryRun = false, directory = '.claude/agents') => new ClaudeAgents(new Workspace(files, new ObsidianDocuments(), events, dryRun), codec, directory);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-claude-agents-'));
  files = await NodeFiles.at(root);
  events = new EventBus(new NodeEventScope());
  for (const id of ['file.created', 'file.updated', 'file.deleted']) events.define({ id, validate: (value): value is object => typeof value === 'object' });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('native agent file management', () => {
  it('creates, inspects and updates nested filename IDs while retaining authored source exactly', async () => {
    const agents = service();
    const created = await agents.create('review/security', source);
    expect(created).toMatchObject({ id: 'review/security', path: '.claude/agents/review/security.md', name: 'reviewer' });
    expect(await readFile(join(root, created.path), 'utf8')).toBe(source);
    const before = await agents.inspect('review/security');
    expect(before.metadata).toMatchObject({ name: 'reviewer', future: { enabled: true } });
    const next = source.replace('Review changes', 'Review security');
    await agents.update('review/security', next, before.revision);
    expect(await readFile(join(root, created.path), 'utf8')).toBe(next);
    await expect(agents.update('review/security', source, before.revision)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(agents.create('review/security', source)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(events.history.map(entry => entry.id)).toEqual(['file.created', 'file.updated']);
  });

  it('previews creation and updates without writing directories or events', async () => {
    const preview = await service(true).create('review', source);
    expect(preview.preview).toEqual([{ path: '.claude/agents/review.md', content: source }]);
    expect(await readdir(root)).toEqual([]);
    await service().create('review', source);
    const before = await service().inspect('review');
    events.history.length = 0;
    expect((await service(true).update('review', source + 'More.', before.revision)).dryRun).toBe(true);
    expect(await readFile(join(root, before.path), 'utf8')).toBe(source);
    expect(events.history).toEqual([]);
  });

  it('lists valid and malformed files independently and reports duplicate native names', async () => {
    await service().create('nested/first', source);
    await service().create('second', source);
    await writeFile(join(root, '.claude/agents/broken.md'), '# Missing frontmatter');
    await writeFile(join(root, '.claude/agents/invalid-utf8.md'), new Uint8Array([0xff]));
    await writeFile(join(root, '.claude/agents/ignored.txt'), 'Not an agent');
    await mkdir(join(root, '.claude/agents-other'));
    await writeFile(join(root, '.claude/agents-other/other.md'), source);
    await symlink(join(root, '.claude/agents/second.md'), join(root, '.claude/agents/alias.md'));
    const result = await service().list();
    expect(result.duplicates).toEqual(['reviewer']);
    expect(result.agents.map(agent => agent.id)).toEqual(['broken', 'invalid-utf8', 'nested/first', 'second']);
    expect(result.agents[0]).toMatchObject({ valid: false, revision: expect.any(String), error: { code: 'INVALID_CLAUDE_AGENT' } });
    expect(result.agents[1]).toMatchObject({ valid: false, error: { code: 'INVALID_ENCODING' } });
    expect(result.agents[2]).toMatchObject({ valid: true, name: 'reviewer', description: 'Review changes' });
    await expect(service().inspect('invalid-utf8')).rejects.toMatchObject({ code: 'INVALID_ENCODING' });
  });

  it('removes malformed definitions with revision guards and dry-run parity', async () => {
    await mkdir(join(root, '.claude/agents'), { recursive: true });
    const path = '.claude/agents/broken.md';
    await writeFile(join(root, path), 'Malformed agent');
    const before = await files.read(path);
    expect((await service(true).remove('broken', before.revision)).dryRun).toBe(true);
    expect(await readFile(join(root, path), 'utf8')).toBe('Malformed agent');
    expect(events.history).toEqual([]);
    await expect(service().remove('broken', 'stale')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await service().remove('broken', before.revision)).changes).toMatchObject([{ path, operation: 'deleted' }]);
    await expect(readFile(join(root, path))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events.history.map(entry => entry.id)).toEqual(['file.deleted']);
  });

  it('keeps configured directories explicit and rejects invalid IDs, source and missing revisions', async () => {
    await service(false, 'plugin/agents').create('native-file', source);
    expect((await service().list()).agents).toEqual([]);
    expect((await service(false, 'plugin/agents').inspect('native-file')).metadata.name).toBe('reviewer');
    for (const id of ['../escape', '/absolute', 'bad\\path', '', 'nested/../escape']) {
      await expect(service().create(id, source)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    }
    await expect(service().create('broken', '# Not valid')).rejects.toMatchObject({ code: 'INVALID_CLAUDE_AGENT' });
    await expect(service().update('missing', source, '')).rejects.toMatchObject({ code: 'MISSING_ARGUMENT' });
    await expect(service().remove('missing', '')).rejects.toMatchObject({ code: 'MISSING_ARGUMENT' });
    expect(await files.list()).toEqual(['plugin/agents/native-file.md']);
  });
});
