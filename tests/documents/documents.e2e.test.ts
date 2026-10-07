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
    const invalid = cli(['list', '--kind', 'markdon']);
    expect(invalid.status).toBe(2);
    expect(invalid.body.error).toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('markdown') });
    const valid = cli(['list', '--kind', 'markdown']);
    expect(valid.status).toBe(0);
    expect(valid.body.data.files).toContainEqual({ path: 'kind-filter.md', kind: 'markdown' });
  });

it('creates and edits notes with guarded revisions, shell-safe stdin and literal replacement', async () => {
    const source = '---\nstatus: draft\n---\n# Task\nBody $HOME `literal`\n';
    expect(cli(['create', 'notes/task.md', '--stdin'], source).status).toBe(0);
    const before = cli(['read', 'notes/task.md']).body.data;
    expect(cli(['properties', 'notes/task.md', '--set', '{"status":"done"}', '--if-match', before.revision, '--dry-run']).body.events).toEqual([]);
    const update = cli(['properties', 'notes/task.md', '--set', '{"status":"done"}', '--if-match', before.revision]);
    expect(update.status).toBe(0); expect(update.body.events[0].id).toBe('file.updated');
    expect(cli(['edit', 'notes/task.md', '--append', '--content', 'stale', '--if-match', before.revision]).body.error.code).toBe('CONFLICT');
    const current = cli(['read', 'notes/task.md']).body.data;
    expect(cli(['edit', 'notes/task.md', '--find', 'Body', '--replace', '$& literal', '--if-match', current.revision]).status).toBe(0);
    expect(await readFile(join(project, 'notes/task.md'), 'utf8')).toContain('$& literal $HOME `literal`');
  });

it('creates and patches valid Canvas and Base documents', () => {
    for (const path of ['plan.canvas', 'tasks.base']) expect(cli(['create', path]).status).toBe(0);
    const canvas = cli(['read', 'plan.canvas']).body.data;
    expect(cli(['patch', 'plan.canvas', '--pointer', '/nodes/-', '--value', '{"id":"a","type":"text","x":0,"y":0,"width":100,"height":100,"text":"Task"}', '--if-match', canvas.revision]).status).toBe(0);
    const base = cli(['read', 'tasks.base']).body.data;
    expect(cli(['patch', 'tasks.base', '--pointer', '/views/0/name', '--value', '"Tasks"', '--if-match', base.revision]).status).toBe(0);
    expect(cli(['validate', 'tasks.base']).body.data.valid).toBe(true);
  });
