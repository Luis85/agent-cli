import { beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
let root: string, selectionPath: string, selection: string;
const file = (project: string, path: string) => join(root, 'projects', project, path);
const run = (args: string[]) => fixture.cli(args, undefined, { root });
const revision = async (path: string) => (await run(['read', path, '--project', 'alpha'])).body.data.revision as string;

beforeEach(async () => {
  root = await mkdtemp(join(fixture.project, 'explicit-'));
  for (const name of ['alpha', 'beta']) {
    await mkdir(file(name, '.forge'), { recursive: true });
    await writeFile(file(name, '.forge/project.json'), JSON.stringify({ schemaVersion: 1, name, type: 'library' }));
    await writeFile(file(name, 'note.md'), `---\nowner: ${name}\n---\n# ${name}\nSee [[other]].\n`);
    await writeFile(file(name, 'other.md'), `# Other ${name}\n`);
    await writeFile(file(name, 'board.canvas'), '{"nodes":[],"edges":[]}\n');
  }
  await mkdir(join(root, 'bin/data'), { recursive: true });
  selectionPath = join(root, 'bin/data/context.json');
  selection = JSON.stringify({ schemaVersion: 1, project: 'beta', directory: 'projects/beta' });
  await writeFile(selectionPath, selection);
});

describe('--project on every project-scoped file command', () => {
  it('reads, searches and checks another project without changing the selection', async () => {
    const reads: string[][] = [['list'], ['search', 'alpha'], ['links', 'out', 'note.md'], ['vault', 'tags'], ['validate', 'note.md']];
    for (const args of reads) {
      const result = await run([...args, '--project', 'alpha']);
      expect(result.status, args.join(' ')).toBe(0);
      expect(result.body.context.project.name, args.join(' ')).toBe('alpha');
    }
    expect((await run(['search', 'alpha', '--project', 'alpha'])).body.data.total).toBe(3);
    expect((await run(['search', 'alpha'])).body.data.total).toBe(0);
    for (const [project, code] of [['missing', 'PROJECT_NOT_FOUND'], ['../alpha', 'INVALID_PROJECT_NAME']]) {
      for (const args of reads) expect((await run([...args, '--project', project!])).body.error.code, args.join(' ')).toBe(code);
    }
    expect(await readFile(selectionPath, 'utf8')).toBe(selection);
  }, 60_000);

  it('writes only the explicit project with every guarded single-file command', async () => {
    const before = await Promise.all(['note.md', 'other.md', 'board.canvas'].map(path => readFile(file('beta', path), 'utf8')));
    const steps: Array<() => Promise<string[]>> = [
      async () => ['create', 'new.md', '--content', 'new\n'],
      async () => ['write', 'new.md', '--content', 'newer\n', '--if-match', await revision('new.md')],
      async () => ['edit', 'note.md', '--find', 'See', '--replace', 'Read', '--if-match', await revision('note.md')],
      async () => ['properties', 'note.md', '--set', '{"status":"done"}', '--if-match', await revision('note.md')],
      async () => ['patch', 'board.canvas', '--pointer', '/nodes/-', '--value', '{"id":"n","type":"text","text":"x","x":0,"y":0,"width":1,"height":1}', '--if-match', await revision('board.canvas')],
      async () => ['rename', 'other.md', 'renamed', '--if-match', await revision('other.md')],
      async () => ['move', 'renamed.md', 'moved/renamed.md', '--if-match', await revision('renamed.md')],
      async () => ['delete', 'new.md', '--if-match', await revision('new.md')],
    ];
    for (const step of steps) {
      const args = await step();
      const result = await run([...args, '--project', 'alpha']);
      expect(result.status, `${args[0]}: ${JSON.stringify(result.body.error)}`).toBe(0);
      expect(result.body.context.project.name).toBe('alpha');
    }
    expect(await readFile(file('alpha', 'note.md'), 'utf8')).toBe('---\nowner: alpha\nstatus: done\n---\n# alpha\nRead [[renamed]].\n');
    expect(await readdir(join(root, 'projects/alpha/moved'))).toEqual(['renamed.md']);
    expect(await readFile(file('alpha', '.trash/new.md'), 'utf8')).toBe('newer\n');
    expect(JSON.parse(await readFile(file('alpha', 'board.canvas'), 'utf8')).nodes).toHaveLength(1);
    expect(await Promise.all(['note.md', 'other.md', 'board.canvas'].map(path => readFile(file('beta', path), 'utf8')))).toEqual(before);
    expect(await readdir(join(root, 'projects/beta'))).toEqual(expect.not.arrayContaining(['new.md', 'moved', '.trash']));
    expect(await readFile(selectionPath, 'utf8')).toBe(selection);
  }, 90_000);
});
