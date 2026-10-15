import { beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
let root: string, selectionPath: string, selection: string;
const file = (project: string, path = 'same.txt') => join(root, 'projects', project, path);
const run = (args: string[], input?: string) => fixture.cli(args, input, { root });
const plan = (content: string, ifMatch: string) => JSON.stringify({ version: 1, operations: [{ op: 'write', path: 'same.txt', content, ifMatch }] });

beforeEach(async () => {
  root = await mkdtemp(join(fixture.project, 'explicit-'));
  for (const name of ['alpha', 'beta']) {
    await mkdir(file(name, '.forge'), { recursive: true });
    await writeFile(file(name, '.forge/project.json'), JSON.stringify({ schemaVersion: 1, name, type: 'library' }));
    await writeFile(file(name), 'identical bytes\n');
  }
  await mkdir(join(root, 'bin/data'), { recursive: true });
  selectionPath = join(root, 'bin/data/context.json');
  selection = JSON.stringify({ schemaVersion: 1, project: 'beta', directory: 'projects/beta' });
  await writeFile(selectionPath, selection);
});

async function unchangedSelection() {
  expect(await readFile(selectionPath, 'utf8')).toBe(selection);
  expect((await run(['project', 'current'])).body.data.project.name).toBe('beta');
}

describe('portable explicit read/apply project targeting', () => {
  it('targets the intended project for identical bytes and retains preview, conflict and path guards', async () => {
    const alpha = await run(['read', 'same.txt', '--project', 'alpha']);
    const beta = await run(['read', 'same.txt']);
    expect(alpha.status).toBe(0);
    expect(alpha.body.context.project.name).toBe('alpha');
    expect(beta.body.context.project.name).toBe('beta');
    expect(alpha.body.data.revision).toBe(beta.body.data.revision);
    const input = plan('alpha only\n', alpha.body.data.revision);
    const preview = await run(['apply', '-', '--project', 'alpha', '--dry-run'], input);
    expect(preview.status).toBe(0);
    expect(preview.body.context.root).toBe(join(root, 'projects/alpha'));
    expect(preview.body.data.dryRun).toBe(true);
    expect(await readFile(file('alpha'), 'utf8')).toBe('identical bytes\n');
    expect((await run(['apply', '-', '--project', 'alpha'], input)).status).toBe(0);
    expect(await readFile(file('alpha'), 'utf8')).toBe('alpha only\n');
    expect(await readFile(file('beta'), 'utf8')).toBe('identical bytes\n');
    expect((await run(['apply', '-', '--project', 'alpha'], input)).body.error.code).toBe('CONFLICT');
    const protectedPlan = JSON.stringify({ version: 1, operations: [{ op: 'delete', path: '.forge/project.json' }] });
    expect((await run(['apply', '-', '--project', 'alpha'], protectedPlan)).body.error.code).toBe('PROTECTED_PATH');
    expect((await run(['read', '../beta/same.txt', '--project', 'alpha'])).body.error.code).toBe('INVALID_PATH');
    await unchangedSelection();
  }, 30_000);

  it('loads plan filenames from the explicit project and refuses unknown or unsafe targets without fallback', async () => {
    const revision = (await run(['read', 'same.txt', '--project', 'alpha'])).body.data.revision;
    await writeFile(file('alpha', 'plan.json'), plan('alpha plan\n', revision));
    await writeFile(file('beta', 'plan.json'), plan('wrong plan\n', revision));
    expect((await run(['apply', 'plan.json', '--project', 'alpha'])).status).toBe(0);
    expect(await readFile(file('alpha'), 'utf8')).toBe('alpha plan\n');
    expect(await readFile(file('beta'), 'utf8')).toBe('identical bytes\n');
    for (const [project, code] of [['missing', 'PROJECT_NOT_FOUND'], ['../alpha', 'INVALID_PROJECT_NAME']]) {
      expect((await run(['read', 'same.txt', '--project', project!])).body.error.code).toBe(code);
      expect((await run(['apply', '-', '--project', project!], plan('do not write', revision))).body.error.code).toBe(code);
    }
    expect((await run(['apply', '-', '--project', 'alpha'], '{"version":1,"operations":[]}')).body.error.code).toBe('INVALID_PLAN');
    expect(await readFile(file('beta'), 'utf8')).toBe('identical bytes\n');
    await unchangedSelection();
  }, 30_000);

  it('routes simultaneous reads and successive guarded writes to their projects without persisting either override', async () => {
    const projects = ['alpha', 'beta'];
    const reads = await Promise.all(projects.map(project => run(['read', 'same.txt', '--project', project])));
    // Writers in different projects share the workspace-root lock and may get a retryable WORKSPACE_BUSY when they overlap.
    const writes = [];
    for (const [index, project] of projects.entries()) writes.push(await run(['apply', '-', '--project', project], plan(`${project}\n`, reads[index]!.body.data.revision)));
    for (const [index, project] of projects.entries()) {
      expect(reads[index]!.status).toBe(0);
      expect(reads[index]!.body.context.project.name).toBe(project);
      expect(writes[index]!.status).toBe(0);
      expect(writes[index]!.body.context.project.name).toBe(project);
      expect(await readFile(file(project), 'utf8')).toBe(`${project}\n`);
    }
    await unchangedSelection();
  }, 30_000);

  it('uses explicit targets with stale or absent saved selection while keeping discovery available', async () => {
    await rm(file('beta', '.forge/project.json'));
    expect((await run(['read', 'same.txt'])).body.error.code).toBe('STALE_PROJECT_CONTEXT');
    const read = await run(['read', 'same.txt', '--project', 'alpha']);
    expect(read.status).toBe(0);
    expect((await run(['apply', '-', '--project', 'alpha'], plan('recovered\n', read.body.data.revision))).status).toBe(0);
    expect(await readFile(selectionPath, 'utf8')).toBe(selection);
    for (const command of ['read', 'apply']) {
      expect((await run([command, '--project', 'missing', '--help'])).status).toBe(0);
      const schema = await run(['schema', command]);
      expect(schema.status).toBe(0);
      expect(schema.stdout).toContain('"project"');
    }
    await rm(selectionPath);
    const explicit = await run(['read', 'same.txt', '--project', 'alpha']);
    expect(explicit.body.context.project.name).toBe('alpha');
    expect((await run(['apply', '-', '--project', 'alpha', '--dry-run'], plan('preview\n', explicit.body.data.revision))).status).toBe(0);
    await expect(readFile(selectionPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);
});
