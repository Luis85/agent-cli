import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generators } from '../src/infrastructure/generators.ts';
import { ProjectService } from '../src/application/projects.ts';
import { EventBus } from '../src/application/events.ts';
import { Workspace } from '../src/application/workspace.ts';
import { NodeFiles } from '../src/infrastructure/files.ts';
import { ObsidianDocuments } from '../src/infrastructure/documents.ts';
import { componentScaffold, projectScaffold } from '../src/infrastructure/project-scaffolds.ts';

let root: string;
let files: NodeFiles;
const execute = promisify(execFile);
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-projects-')); files = await NodeFiles.at(root); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
function service(directory = 'projects', dryRun = false, events = new EventBus()) {
  events.defineAll(['file.created', 'file.updated'].map(id => ({ id, validate: (value): value is object => typeof value === 'object' })));
  return new ProjectService(files, new Workspace(files, new ObsidianDocuments(), events, dryRun), directory, { project: projectScaffold, component: componentScaffold });
}

describe('Forge project management', () => {
  it('creates and discovers independent projects beneath the configured directory', async () => {
    const projects = service('src');
    await projects.create('billing');
    await projects.create('accounts');
    expect((await projects.list()).map(project => project.name)).toEqual(['accounts', 'billing']);
    expect(await projects.inspect('billing')).toEqual({ schemaVersion: 1, name: 'billing', type: 'library', directory: 'src/billing' });
    expect(await service().list()).toEqual([]);
    expect(await readFile(join(root, 'src/billing/AGENTS.md'), 'utf8')).toContain('npm run check');
    expect(JSON.parse(await readFile(join(root, 'src/billing/package.json'), 'utf8')).devDependencies).toMatchObject({ typescript: '5.9.3', vite: '7.3.7', vitest: '3.2.7' });
  });

  it('dry-runs a complete plan without creating directories or metadata', async () => {
    const result = await service('projects', true).create('billing');
    expect(result.dryRun).toBe(true);
    expect(result.changes.some(change => change.path === 'projects/billing/.forge/project.json')).toBe(true);
    expect(result.preview?.find(file => file.path === 'projects/billing/AGENTS.md')?.content).toContain('npm run check');
    expect(await readdir(root)).toEqual([]);
  });

  it('refuses to claim an existing directory or overwrite components', async () => {
    await mkdir(join(root, 'projects/existing'), { recursive: true });
    await writeFile(join(root, 'projects/existing/notes.txt'), 'User content');
    await expect(service().create('existing')).rejects.toMatchObject({ code: 'PROJECT_EXISTS' });
    await service().create('billing');
    await service().component('billing', 'Invoice');
    await expect(service().component('billing', 'Invoice')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(join(root, 'projects/existing/notes.txt'), 'utf8')).toBe('User content');
  });

  it('requires valid matching project metadata before adding a component', async () => {
    await expect(service().component('missing', 'Invoice')).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    await service().create('billing');
    const marker = join(root, 'projects/billing/.forge/project.json');
    await writeFile(marker, JSON.stringify({ schemaVersion: 1, name: 'other', type: 'library' }));
    await expect(service().component('billing', 'Invoice')).rejects.toMatchObject({ code: 'INVALID_PROJECT' });
    await writeFile(marker, '{broken');
    await expect(service().inspect('billing')).rejects.toMatchObject({ code: 'INVALID_PROJECT' });
    expect(await files.list()).not.toContain('projects/billing/src/domain/invoice.ts');
  });

  it('validates project names, component names and kinds before writes', async () => {
    await expect(service().create('../outside')).rejects.toMatchObject({ code: 'INVALID_PROJECT_NAME' });
    await expect(service().create('Invalid_Name')).rejects.toMatchObject({ code: 'INVALID_PROJECT_NAME' });
    expect(() => service('../outside')).toThrow();
    await service().create('billing');
    await expect(service().component('billing', '../Invoice')).rejects.toMatchObject({ code: 'INVALID_NAME' });
    await expect(service().component('billing', 'Invoice', 'ui' as 'domain')).rejects.toMatchObject({ code: 'INVALID_COMPONENT_KIND' });
  });

  it('supports domain and application components without changing the public API implicitly', async () => {
    await service().create('billing');
    const domain = await service().component('billing', 'HTTPInvoice');
    const application = await service().component('billing', 'FindInvoice', 'application');
    expect(domain.changes.map(change => change.path)).toContain('projects/billing/src/domain/http-invoice.ts');
    expect(application.changes.map(change => change.path)).toContain('projects/billing/src/application/find-invoice.ts');
    const index = await readFile(join(root, 'projects/billing/src/index.ts'), 'utf8');
    expect(index).not.toContain('HTTPInvoice');
    const dry = await service('projects', true).component('billing', 'DraftInvoice');
    expect(dry.dryRun).toBe(true);
    expect(dry.preview?.find(file => file.path.endsWith('/draft-invoice.ts'))?.content).toContain('export class DraftInvoice');
    expect(await files.list()).not.toContain('projects/billing/src/domain/draft-invoice.ts');
  });

  it('starts without a selected project and closes without creating context state', async () => {
    expect(await service().current()).toBeNull();
    await expect(service().requireCurrent()).rejects.toMatchObject({ code: 'PROJECT_REQUIRED', message: expect.stringContaining('project open') });
    const writes = vi.spyOn(files, 'writeBatch');
    expect(await service().close()).toEqual({ project: null, dryRun: false, changes: [] });
    expect(writes).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it('persists project selection across invocations and emits only committed changes', async () => {
    await service('src').create('billing');
    await service('src').create('accounts');
    const events = new EventBus();
    const projects = service('src', false, events);
    const opened = await projects.open('billing');
    expect(opened.project).toEqual(await projects.inspect('billing'));
    expect(opened.changes).toMatchObject([{ path: 'bin/data/context.json', operation: 'created' }]);
    expect(await service('src').requireCurrent()).toEqual(opened.project);
    expect(events.history.map(event => event.id)).toEqual(['file.created']);
    const writes = vi.spyOn(files, 'writeBatch');
    expect((await projects.open('billing')).changes).toEqual([]);
    expect(writes).not.toHaveBeenCalled();
    expect(events.history).toHaveLength(1);
    await projects.open('accounts');
    expect(await service('src').current()).toMatchObject({ name: 'accounts', directory: 'src/accounts' });
    expect((await projects.close()).changes).toMatchObject([{ operation: 'updated' }]);
    expect(await service('src').current()).toBeNull();
    expect(JSON.parse(await readFile(join(root, 'bin/data/context.json'), 'utf8'))).toEqual({ schemaVersion: 1, project: null });
    writes.mockClear();
    expect((await projects.close()).changes).toEqual([]);
    expect(writes).not.toHaveBeenCalled();
    expect(events.history.map(event => event.id)).toEqual(['file.created', 'file.updated', 'file.updated']);
  });

  it('previews opening and closing without changing the persisted selection or emitting events', async () => {
    await service().create('billing');
    await service().create('accounts');
    const events = new EventBus();
    const preview = service('projects', true, events);
    expect(await preview.open('billing')).toMatchObject({
      project: { name: 'billing' }, dryRun: true,
      preview: [{ path: 'bin/data/context.json', content: expect.stringContaining('billing') }],
    });
    expect(await service().current()).toBeNull();
    await service().open('billing');
    const before = await readFile(join(root, 'bin/data/context.json'), 'utf8');
    expect(await preview.open('accounts')).toMatchObject({ project: { name: 'accounts' }, dryRun: true });
    expect(await preview.close()).toMatchObject({ project: null, dryRun: true, preview: [{ content: expect.stringContaining('"project": null') }] });
    expect((await preview.open('billing')).preview).toEqual([]);
    expect(await readFile(join(root, 'bin/data/context.json'), 'utf8')).toBe(before);
    expect(await service().current()).toMatchObject({ name: 'billing' });
    expect(events.history).toEqual([]);
  });

  it.each([
    '{broken', '[]', '{}', '{"schemaVersion":2,"project":null}',
    '{"schemaVersion":1,"project":"../billing"}', '{"schemaVersion":1,"project":false}',
    '{"schemaVersion":1,"project":"billing"}', '{"schemaVersion":1,"project":"billing","directory":"projects/accounts"}',
    '{"schemaVersion":1,"project":"billing","directory":"../projects/billing"}',
    new Uint8Array([255]),
  ])('reports malformed context and permits explicit recovery: %j', async malformed => {
    await service().create('billing');
    await mkdir(join(root, 'bin/data'), { recursive: true });
    const context = join(root, 'bin/data/context.json');
    await writeFile(context, malformed);
    await expect(service().current()).rejects.toMatchObject({ code: 'INVALID_PROJECT_CONTEXT', message: expect.stringContaining('project close') });
    await service().open('billing');
    expect(await service().current()).toMatchObject({ name: 'billing' });
    await writeFile(context, malformed);
    await service().close();
    expect(await service().current()).toBeNull();
  });

  it.each(['missing', 'invalid'])('reports a %s selected project and permits selecting another project or closing', async failure => {
    await service().create('billing');
    await service().create('accounts');
    await service().open('billing');
    const marker = join(root, 'projects/billing/.forge/project.json');
    if (failure === 'missing') await rm(marker);
    else await writeFile(marker, '{}');
    await expect(service().current()).rejects.toMatchObject({ code: 'STALE_PROJECT_CONTEXT', message: expect.stringContaining('project open') });
    await service().open('accounts');
    expect(await service().current()).toMatchObject({ name: 'accounts' });
    await writeFile(join(root, 'bin/data/context.json'), JSON.stringify({ schemaVersion: 1, project: 'billing' }));
    await service().close();
    expect(await service().current()).toBeNull();
  });

  it('validates a new project before replacing the existing selection', async () => {
    await service().create('billing');
    await service().open('billing');
    const before = await readFile(join(root, 'bin/data/context.json'), 'utf8');
    await expect(service().open('missing')).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    await expect(service().open('../outside')).rejects.toMatchObject({ code: 'INVALID_PROJECT_NAME' });
    expect(await readFile(join(root, 'bin/data/context.json'), 'utf8')).toBe(before);
  });

  it('requires explicit selection after the configured directory changes, even for matching project names', async () => {
    await service('projects').create('billing');
    await service('other').create('billing');
    await service('projects').open('billing');
    const before = await readFile(join(root, 'bin/data/context.json'), 'utf8');
    await expect(service('other').current()).rejects.toMatchObject({ code: 'STALE_PROJECT_CONTEXT', message: expect.stringContaining('project open') });
    expect(await readFile(join(root, 'bin/data/context.json'), 'utf8')).toBe(before);
    expect((await service('other', true).open('billing')).changes).toMatchObject([{ operation: 'updated' }]);
    expect(await readFile(join(root, 'bin/data/context.json'), 'utf8')).toBe(before);
    expect((await service('other').open('billing')).changes).toMatchObject([{ operation: 'updated' }]);
    expect(await service('other').current()).toMatchObject({ directory: 'other/billing' });
    await service('projects').close();
    expect(await service('projects').current()).toBeNull();
  });

  it('preserves a concurrent selection instead of overwriting its newer revision', async () => {
    await service().create('billing');
    await service().create('accounts');
    await service().open('billing');
    const newer = JSON.stringify({ schemaVersion: 1, project: 'accounts', directory: 'projects/accounts' });
    const writeBatch = files.writeBatch.bind(files);
    vi.spyOn(files, 'writeBatch').mockImplementationOnce(async (writes, dryRun) => {
      await writeFile(join(root, 'bin/data/context.json'), newer);
      return writeBatch(writes, dryRun);
    });
    await expect(service().close()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(join(root, 'bin/data/context.json'), 'utf8')).toBe(newer);
    expect(await service().current()).toMatchObject({ name: 'accounts' });
  });

  it('produces deterministic file plans', () => {
    expect(projectScaffold('billing', 'projects')).toEqual(projectScaffold('billing', 'projects'));
    expect(componentScaffold('billing', 'Invoice', 'projects')).toEqual(componentScaffold('billing', 'Invoice', 'projects'));
  });

  it('checks the generated library and both component kinds, diagnoses mistakes, and passes after repair', async () => {
    await service().create('billing');
    await service().component('billing', 'Invoice');
    await service().component('billing', 'FindInvoice', 'application');
    // Use the test workspace's existing toolchain; no dependency install or network access.
    const project = join(root, 'projects/billing');
    await symlink(resolve('node_modules'), join(project, 'node_modules'), 'dir');
    const run = (script: string) => execute('npm', ['run', script], { cwd: project, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }).catch(error => { throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`); });
    const quality = (script: string) => execute(process.execPath, [`scripts/quality/${script}.mjs`], { cwd: project, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
    const form = generators.find(generator => generator.id === 'form')!;
    const projectFiles = await NodeFiles.at(project);
    for (const [name, output] of [['Contact', 'src/presentation/forms'], ['Quoted', "src/presentation/quoted'forms"]]) {
      await projectFiles.writeBatch(await form.generate(name!, output!), false);
    }
    await run('check');
    const invoice = join(project, 'src/domain/invoice.ts');
    const original = await readFile(invoice, 'utf8');
    await writeFile(invoice, original + '\n// Explanation\n'.repeat(401));
    await quality('lint');
    await writeFile(invoice, original + 'void 0;\n'.repeat(401));
    await expect(quality('lint')).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('max-lines') });
    await writeFile(invoice, original);
    const unlabeled = join(project, 'tests/unlabeled.test.ts');
    await writeFile(unlabeled, "import { it } from 'vitest';\nit('example', () => {});\n");
    await expect(quality('structure')).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('test-pyramid') });
    await rm(unlabeled);
    await quality('structure');
    await writeFile(invoice, original + '\ndebugger;\n');
    await expect(quality('lint')).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('no-debugger') });
    await writeFile(invoice, original);
    await quality('lint');

    const unused = join(project, 'src/domain/unused.ts');
    await writeFile(unused, 'export const orphan = true;\n');
    await expect(quality('analyze')).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('src/domain/unused.ts') });
    await rm(unused);
    await quality('analyze');

    const adapter = join(project, 'src/infrastructure/runtime.ts');
    await writeFile(adapter, 'export const runtime = () => true;\n');
    await writeFile(invoice, "import { runtime } from '../infrastructure/runtime.ts';\nruntime();\n" + original);
    await expect(quality('analyze')).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('boundary') });
    await writeFile(invoice, original);
    await rm(adapter);

    await writeFile(invoice, "import { readFile } from 'node:fs/promises';\nvoid readFile;\n" + original);
    await expect(quality('lint')).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('no-restricted-imports') });
    await writeFile(invoice, original);
    await run('check:fast');
    expect(await readFile(join(project, 'dist/index.js'), 'utf8')).toContain('ProjectIdentity');
    expect(await readFile(join(project, 'dist/index.d.ts'), 'utf8')).toContain('ProjectDetailsForm');
    expect(await readFile(join(project, 'demo-dist/index.html'), 'utf8')).toContain('Form preview');
  }, 60000);
});
