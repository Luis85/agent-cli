import { describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
async function put(root: string, path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
async function vault(name: string) {
  const root = join(fixture.project, name);
  await mkdir(root);
  return { root, cli: (args: string[]) => fixture.cli(['bases', ...args], undefined, { root }) };
}
const definition = stringify({
  filters: 'file.ext == "md" && status == "open"',
  formulas: { score: 'priority * 2' },
  views: [
    { type: 'table', name: 'All open', sort: [{ property: 'formula.score', direction: 'DESC' }] },
    { type: 'list', name: 'For context', filters: 'owner == this.owner && file.hasLink(this.file)', sort: [{ property: 'priority', direction: 'DESC' }] },
  ],
});

describe('portable native Bases repositories', () => {
  it('discovers and inspects native definitions, evaluates named views and context, and reports compatibility', async () => {
    const { root, cli } = await vault('queries');
    await put(root, 'queries/tasks.base', definition);
    await put(root, '.hidden/ignored.base', 'invalid: [');
    await put(root, '.claude/agents/ignored.md', '---\ninvalid: [\n---');
    await put(root, 'Projects/Context.md', '---\nowner: Ada\n---\n# Project');
    await put(root, 'Notes/A.md', '---\nstatus: open\nowner: Ada\npriority: 3\n---\n[[Projects/Context]]');
    await put(root, 'Notes/B.md', '---\nstatus: open\nowner: Ben\npriority: 8\n---\n[[Projects/Context]]');
    await put(root, 'Notes/C.md', '---\nstatus: open\nowner: Ada\npriority: 1\n---\n[[Projects/Context]]');
    await put(root, 'Notes/Done.md', '---\nstatus: done\nowner: Ada\npriority: 99\n---\n');
    const before = await readFile(join(root, 'queries/tasks.base'));
    const listed = cli(['list']);
    expect(listed.status).toBe(0);
    expect(listed.body.data).toEqual({ files: ['queries/tasks.base'], scope: root });
    expect(cli([]).body.data).toEqual(listed.body.data);
    const inspected = cli(['inspect', 'queries/tasks.base']);
    expect(inspected.status).toBe(0);
    expect(inspected.body.data).toMatchObject({ path: 'queries/tasks.base', revision: expect.any(String),
      definition: { formulas: { score: 'priority * 2' } }, views: [{ name: 'All open' }, { name: 'For context' }],
      repository: { path: 'queries/tasks.base', viewSelection: 'name; first view when omitted' } });
    const all = cli(['query', 'queries/tasks.base']);
    expect(all.status).toBe(0);
    expect(all.body.data).toMatchObject({ path: 'queries/tasks.base', view: 'All open', context: 'queries/tasks.base',
      files: ['Notes/B.md', 'Notes/A.md', 'Notes/C.md'], total: 3, scope: root,
      repository: { path: 'queries/tasks.base', view: 'All open' } });
    const named = cli(['query', 'queries/tasks.base', '--view', 'For context', '--context', 'Projects/Context.md', '--limit', '1']);
    expect(named.status).toBe(0);
    expect(named.body.data).toMatchObject({ view: 'For context', context: 'Projects/Context.md', files: ['Notes/A.md'], total: 2 });
    expect(cli(['query', 'queries/tasks.base', '--limit', '0']).body.data).toMatchObject({ files: [], total: 3 });
    expect(cli(['query', 'queries/tasks.base', '--dry-run']).body.data.files).toEqual(all.body.data.files);
    const capabilities = cli(['capabilities']);
    expect(capabilities.status).toBe(0);
    expect(capabilities.body.data).toMatchObject({ standalone: true, engine: 'obsidian-bases-expression', version: '0.2.0' });
    expect(capabilities.body.data.query).toContain('this-context');
    expect(capabilities.body.data.limits).toContainEqual(expect.stringContaining('not verified against a running Obsidian'));
    for (const response of [listed, inspected, all, named, capabilities]) {
      expect(response.body.context).toEqual({ root, workspaceRoot: root, project: null });
      expect(response.body.events).toEqual([]);
    }
    expect(await readFile(join(root, 'queries/tasks.base'))).toEqual(before);
    expect(await readdir(root)).not.toContain('.agent-cli.lock');
  }, 15000);

  it('reports invalid definitions, missing views/context and expression failures without partial successful results', async () => {
    const { root, cli } = await vault('errors');
    await put(root, 'tasks.base', definition);
    await put(root, 'Note.md', '---\nstatus: open\npriority: 1\n---');
    const errors: Array<{ args: string[]; code: string }> = [
      { args: ['query', 'tasks.base', '--view', 'Missing'], code: 'BASE_VIEW_NOT_FOUND' },
      { args: ['query', 'tasks.base', '--context', 'Missing.md'], code: 'BASE_CONTEXT_NOT_FOUND' },
      { args: ['query', 'tasks.base', '--limit', '-1'], code: 'INVALID_BASE_QUERY' },
      { args: ['query', 'tasks.base', '--limit', 'not-a-number'], code: 'INVALID_BASE_QUERY' },
      { args: ['query', 'tasks.base', '--view', ''], code: 'INVALID_BASE_QUERY' },
      { args: ['query', '../tasks.base'], code: 'INVALID_PATH' },
      { args: ['query', 'tasks.base', '--context', '../Note.md'], code: 'INVALID_PATH' },
      { args: ['inspect', 'Note.md'], code: 'INVALID_BASE' },
      { args: ['list', '--view', 'All open'], code: 'INVALID_ARGUMENT' },
      { args: ['query', 'absent.base'], code: 'NOT_FOUND' },
    ];
    for (const { args, code } of errors) {
      const result = cli(args);
      expect(result.status).not.toBe(0);
      expect(result.body).toMatchObject({ ok: false, error: { code }, events: [] });
      expect(result.body.data).toBeUndefined();
    }
    await put(root, 'broken.base', 'views: invalid\n');
    expect(cli(['inspect', 'broken.base']).body.error.code).toBe('INVALID_BASE');
    await put(root, 'tasks.base', stringify({ formulas: { invalid: 'points ==' }, views: [{ type: 'table', name: 'Invalid' }] }));
    expect(cli(['query', 'tasks.base']).body.error.code).toBe('INVALID_BASE_EXPRESSION');
    await put(root, 'tasks.base', stringify({ filters: 'file.unknownFunction()', views: [{ type: 'table', name: 'Invalid' }] }));
    expect(cli(['query', 'tasks.base']).body.error.code).toBe('BASE_EVALUATION_ERROR');
  }, 15000);

  it('queries only the explicitly selected vault even when launched from another project directory', async () => {
    const { root } = await vault('selection');
    for (const name of ['alpha', 'beta']) expect(fixture.cli(['project', 'create', name], undefined, { root }).status).toBe(0);
    const alpha = join(root, 'projects/alpha'), beta = join(root, 'projects/beta');
    const base = stringify({ filters: 'kind == "task"', views: [{ type: 'table', name: 'Tasks' }] });
    for (const [directory, name] of [[root, 'Workspace'], [alpha, 'Alpha'], [beta, 'Beta']]) {
      await put(directory!, 'tasks.base', base);
      await put(directory!, `${name}.md`, '---\nkind: task\n---\n');
    }
    expect(fixture.cli(['project', 'open', 'alpha'], undefined, { root }).status).toBe(0);
    const result = fixture.cli(['bases', 'query', 'tasks.base'], undefined, { root, cwd: beta });
    expect(result.status).toBe(0);
    expect(result.body.context).toMatchObject({ root: alpha, workspaceRoot: root, project: { name: 'alpha' } });
    expect(result.body.data).toMatchObject({ files: ['Alpha.md'], total: 1, scope: alpha });
    expect(fixture.cli(['bases', 'list'], undefined, { root, cwd: beta }).body.data).toEqual({ files: ['tasks.base'], scope: alpha });
    expect(fixture.cli(['bases', 'inspect', 'tasks.base'], undefined, { root, cwd: beta }).body.context.root).toBe(alpha);
    expect(fixture.cli(['bases', 'query', '../beta/tasks.base'], undefined, { root }).body.error.code).toBe('INVALID_PATH');
    expect(fixture.cli(['project', 'open', 'beta'], undefined, { root }).status).toBe(0);
    expect(fixture.cli(['bases', 'query', 'tasks.base'], undefined, { root }).body.data.files).toEqual(['Beta.md']);
    expect(result.body.events).toEqual([]);
  }, 15000);
});
