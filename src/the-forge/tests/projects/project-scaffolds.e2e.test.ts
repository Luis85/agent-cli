import { committedEvents } from '../support/events.ts';
import { beforeAll, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
let project: string;
beforeAll(() => { project = fixture.project; });

it('creates discoverable library projects and tested components in the configured directory', async () => {
    await mkdir(join(project, 'bin'), { recursive: true });
    const config = join(project, 'bin/config.json');
    await writeFile(config, JSON.stringify({ paths: { projects: 'src' } }));
    const args: string[] = [];
    expect(cli([...args, 'project', 'list']).body.data.projects).toEqual([]);
    const preview = cli([...args, 'project', 'create', 'task-lib', '--dry-run']);
    expect(preview.status).toBe(0); expect(committedEvents(preview.body.events)).toEqual([]);
    await expect(readFile(join(project, 'src/task-lib/package.json'))).rejects.toThrow();
    expect(cli([...args, 'project', 'create', 'task-lib']).status).toBe(0);
    const manifest = JSON.parse(await readFile(join(project, 'src/task-lib/package.json'), 'utf8'));
    expect(manifest).toMatchObject({
      name: 'task-lib',
      scripts: { 'check:fast': 'npm run check:structure && npm run lint && npm run analyze && npm run typecheck', check: 'npm run check:fast && npm run build && npm test' },
      devDependencies: { fallow: expect.any(String), oxlint: expect.any(String), vite: expect.any(String), vitest: expect.any(String), typescript: expect.any(String) },
    });
    expect(cli([...args, 'project', 'list']).body.data.projects).toEqual([{ schemaVersion: 1, name: 'task-lib', type: 'library', directory: 'src/task-lib' }]);
    expect(cli([...args, 'project', 'inspect', 'task-lib']).body.data.directory).toBe('src/task-lib');
    expect(committedEvents(cli([...args, 'project', 'component', 'task-lib', 'WorkItem', '--dry-run']).body.events)).toEqual([]);
    await expect(readFile(join(project, 'src/task-lib/src/domain/work-item.ts'))).rejects.toThrow();
    expect(cli([...args, 'project', 'component', 'task-lib', 'WorkItem']).status).toBe(0);
    expect(await readFile(join(project, 'src/task-lib/tests/work-item.domain.unit.test.ts'), 'utf8')).toContain('rejects an empty identity');
    expect(cli([...args, 'project', 'component', 'task-lib', 'FindItem', '--kind', 'application']).status).toBe(0);
    expect(await readFile(join(project, 'src/task-lib/src/application/find-item.ts'), 'utf8')).toContain('FindItemRepository');
    expect(cli([...args, 'project', 'component', 'task-lib', 'WorkItem']).body.error.code).toBe('CONFLICT');
    expect(cli([...args, 'project', 'create', 'task-lib']).body.error.code).toBe('PROJECT_EXISTS');
    expect(cli([...args, 'project', 'inspect', 'absent']).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect(cli([...args, 'project', 'create', '../escape']).body.error.code).toBe('INVALID_PROJECT_NAME');
    expect(cli([...args, 'project', 'component', 'task-lib', 'Other', '--kind', 'infrastructure']).body.error.code).toBe('INVALID_ARGUMENT');
    await rm(config);
  });
