import { committedEvents } from '../support/events.ts';
import { beforeAll, expect, it } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
let project: string;
beforeAll(() => { project = fixture.project; });

it('rejects unsupported file kinds instead of reporting an empty workspace', async () => {
    await writeFile(join(project, 'kind-filter.md'), '# Discoverable note\n');
    const invalid = await cli(['list', '--kind', 'markdon']);
    expect(invalid.status).toBe(2);
    expect(invalid.body.error).toMatchObject({ code: 'INVALID_OPTION_VALUE', message: expect.stringContaining('markdown') });
    const valid = await cli(['list', '--kind', 'markdown']);
    expect(valid.status).toBe(0);
    expect(valid.body.data.files).toContainEqual({ path: 'kind-filter.md', kind: 'markdown' });
  });

it('lists files matching a path glob in pages joined by nextCursor', async () => {
    for (const name of ['a', 'b', 'c']) await writeFile(join(project, `glob-${name}.md`), `# ${name}\n`);
    const first = await cli(['list', '--path', 'glob-*.md', '--limit', '2']);
    expect(first.body.data.files).toEqual([{ path: 'glob-a.md', kind: 'markdown' }, { path: 'glob-b.md', kind: 'markdown' }]);
    expect((await cli(['list', '--path', 'glob-*.md', '--limit', '2', '--cursor', first.body.data.nextCursor])).body.data).toEqual({ files: [{ path: 'glob-c.md', kind: 'markdown' }] });
    expect((await cli(['list', '--path', '*.md', '--cursor', first.body.data.nextCursor])).body.error.code).toBe('INVALID_ARGUMENT');
  });

it('creates and edits notes with guarded revisions, shell-safe stdin and literal replacement', async () => {
    const source = '---\nstatus: draft\n---\n# Task\nBody $HOME `literal`\n';
    expect((await cli(['create', 'notes/task.md', '--stdin'], source)).status).toBe(0);
    const before = (await cli(['read', 'notes/task.md'])).body.data;
    expect(committedEvents((await cli(['properties', 'notes/task.md', '--set', '{"status":"done"}', '--if-match', before.revision, '--dry-run'])).body.events)).toEqual([]);
    const update = await cli(['properties', 'notes/task.md', '--set', '{"status":"done"}', '--if-match', before.revision]);
    expect(update.status).toBe(0); expect(committedEvents(update.body.events)[0]?.id).toBe('vault.modify');
    expect((await cli(['edit', 'notes/task.md', '--append', '--content', 'stale', '--if-match', before.revision])).body.error.code).toBe('CONFLICT');
    const current = (await cli(['read', 'notes/task.md'])).body.data;
    expect((await cli(['edit', 'notes/task.md', '--find', 'Body', '--replace', '$& literal', '--if-match', current.revision])).status).toBe(0);
    expect(await readFile(join(project, 'notes/task.md'), 'utf8')).toContain('$& literal $HOME `literal`');
  });

it('creates and patches valid Canvas and Base documents', async () => {
    for (const path of ['plan.canvas', 'tasks.base']) expect((await cli(['create', path])).status).toBe(0);
    const canvas = (await cli(['read', 'plan.canvas'])).body.data;
    expect((await cli(['patch', 'plan.canvas', '--pointer', '/nodes/-', '--value', '{"id":"a","type":"text","x":0,"y":0,"width":100,"height":100,"text":"Task"}', '--if-match', canvas.revision])).status).toBe(0);
    const base = (await cli(['read', 'tasks.base'])).body.data;
    expect((await cli(['patch', 'tasks.base', '--pointer', '/views/0/name', '--value', '"Tasks"', '--if-match', base.revision])).status).toBe(0);
    expect((await cli(['validate', 'tasks.base'])).body.data.valid).toBe(true);
  });
