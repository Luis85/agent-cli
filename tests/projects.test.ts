import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function service(directory = 'projects', dryRun = false) {
  const events = new EventBus();
  events.define({ id: 'file.created', validate: (value): value is object => typeof value === 'object' });
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
    const run = (script: string) => execute('npm', ['run', script], { cwd: project, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const quality = (script: string) => execute(process.execPath, [`scripts/quality/${script}.mjs`], { cwd: project, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
    await run('check');
    const invoice = join(project, 'src/domain/invoice.ts');
    const original = await readFile(invoice, 'utf8');
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
    expect(await readFile(join(project, 'dist/index.d.ts'), 'utf8')).toContain('ProjectIdentity');
  }, 60000);
});
