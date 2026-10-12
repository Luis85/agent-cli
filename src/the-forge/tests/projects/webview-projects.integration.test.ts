import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectService, type ProjectType } from '../../src/application/projects/projects.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { componentScaffold, projectScaffold } from '../../src/plugins/scaffolds/infrastructure/projects.ts';

let root: string;
let files: NodeFiles;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-webview-projects-'));
  files = await NodeFiles.at(root);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function service(directory = 'src', dryRun = false) {
  const events = new EventBus(new NodeEventScope());
  const workspace = new Workspace(files, new ObsidianDocuments(), events, dryRun);
  return new ProjectService(files, workspace, directory, () => ({ project: projectScaffold, component: componentScaffold }), events);
}

describe('webview project creation', () => {
  it('previews a complete independent project without changing the workspace', async () => {
    const result = await service('apps/prototypes', true).create('task-board', 'webview');
    expect(result.project).toEqual({ schemaVersion: 1, name: 'task-board', type: 'webview', directory: 'apps/prototypes/task-board' });
    expect(result.preview?.find(file => file.path.endsWith('/package.json'))?.content).toContain('"@nuxt/ui"');
    const paths = result.preview!.map(file => file.path.slice('apps/prototypes/task-board/'.length));
    expect(paths).toEqual(expect.arrayContaining(['README.md', 'AGENTS.md', 'PRODUCT.md', 'DESIGN.md', 'tests/prototype.unit.test.ts', 'tests/e2e/webview.e2e.test.ts']));
    const manifest = JSON.parse(result.preview!.find(file => file.path.endsWith('/package.json'))!.content);
    expect(manifest.config.forgeWorkspace).toBe('../../../');
    expect(result.preview?.some(file => /__[A-Z_]+__/.test(file.content))).toBe(false);
    expect(result.nextSteps).toEqual(expect.arrayContaining([
      { scope: 'workspace', command: 'node bin/forge.js webview publish --project task-board --dry-run' },
      { scope: 'workspace', command: 'node bin/forge.js server start --webview task-board' },
    ]));
    expect(await readdir(root)).toEqual([]);
  });

  it('discovers and selects the new type while creation preserves the existing selection', async () => {
    const projects = service();
    await projects.create('library');
    await projects.open('library');
    const previous = await readFile(join(root, 'bin/data/context.json'));
    await projects.create('task-board', 'webview');
    expect(await readFile(join(root, 'bin/data/context.json'))).toEqual(previous);
    expect((await projects.list()).map(project => [project.name, project.type])).toEqual([
      ['library', 'library'], ['task-board', 'webview'],
    ]);
    await projects.open('task-board');
    expect(await projects.current()).toMatchObject({ name: 'task-board', type: 'webview' });
    await projects.component('task-board', 'Task');
    expect(await readFile(join(root, 'src/task-board/src/domain/task.ts'), 'utf8')).toContain('export class Task');
    await expect(projects.create('task-board', 'webview')).rejects.toMatchObject({ code: 'PROJECT_EXISTS' });
  });

  it('rejects unsupported types and invalid names before writing any files', async () => {
    await expect(service().create('task-board', 'native' as ProjectType)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service().create('../task-board', 'webview')).rejects.toMatchObject({ code: 'INVALID_PROJECT_NAME' });
    await expect(service().create('admin', 'webview')).rejects.toMatchObject({ code: 'INVALID_PROJECT_NAME', message: expect.stringContaining('reserved') });
    expect(await readdir(root)).toEqual([]);
    await service().create('admin');
    expect(await service().inspect('admin')).toMatchObject({ type: 'library' });
  });

  it('keeps generation deterministic and workspace-relative for custom project locations', () => {
    const plan = projectScaffold('task-board', 'packages/apps', 'webview');
    expect(plan).toEqual(projectScaffold('task-board', 'packages/apps', 'webview'));
    expect(plan.every(file => file.path.startsWith('packages/apps/task-board/'))).toBe(true);
    expect(plan.some(file => file.path.includes('forge-admin'))).toBe(false);
    const marker = plan.find(file => file.path.endsWith('/.forge/project.json'))!;
    expect(JSON.parse(new TextDecoder().decode(marker.bytes))).toEqual({ schemaVersion: 1, name: 'task-board', type: 'webview' });
  });
});
