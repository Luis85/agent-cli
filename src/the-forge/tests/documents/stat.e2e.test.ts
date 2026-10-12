import { beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { statOutput } from '../../src/presentation/documents/stat-output.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';

const fixture = portableCli();
let root: string;
beforeEach(async () => { root = await mkdtemp(join(fixture.project, 'metadata-')); });
const cli = (args: string[]) => fixture.cli(args, undefined, { root });

describe('portable stat workflows', () => {
  it('gets a malformed document revision for guarded repair and discovers the metadata contract', async () => {
    await writeFile(join(root, 'bad.md'), '---\nvalue: [\n---\n');
    expect((await cli(['read', 'bad.md'])).body.error.code).toBe('INVALID_YAML');
    const result = await cli(['stat', 'bad.md']);
    expect(result.status).toBe(0);
    expect(validateJsonValue(statOutput, result.body.data, 'data').issues).toEqual([]);
    expect(result.body.events).toEqual([]);
    const write = ['write', 'bad.md', '--content', '# Repaired\n', '--if-match', result.body.data.revision];
    expect((await cli([...write, '--dry-run'])).status).toBe(0);
    expect((await cli(write)).status).toBe(0);
    expect((await cli(['read', 'bad.md'])).body.data.document.content).toBe('# Repaired\n');
    expect((await cli(write)).body.error.code).toBe('CONFLICT');
    const help = (await cli(['help', 'stat'])).body.data;
    expect(help).toMatchObject({ id: 'stat', usage: 'stat <path> [--project id]', annotations: { scope: 'project', mutating: false } });
    expect(help.options.project.type).toBe('string');
    const schema = (await cli(['schema', 'stat'])).body.data;
    expect(schema.commands[0].outputSchema).toEqual({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'stat output', ...statOutput });
    expect(schema.commands[0].errors).toEqual(expect.arrayContaining(['PROJECT_NOT_FOUND', 'INVALID_PROJECT_NAME', 'INVALID_PROJECT', 'INVALID_PROJECT_CONTEXT']));
    expect(schema.errors.map((error: { code: string }) => error.code)).toEqual(expect.arrayContaining(['PROJECT_NOT_FOUND', 'INVALID_PROJECT_NAME', 'INVALID_PROJECT', 'INVALID_PROJECT_CONTEXT']));
    const german = (await cli(['--lang', 'de', 'help', 'stat'])).body.data;
    expect(german.description).toContain('Revision einer Datei');
    expect(german.options.project.description).toBe('Dieses Projekt statt des ausgewählten Projekts verwenden.');
  }, 30_000);

  it('supplies the exact folder move and deletion guard without creating a pretend destination', async () => {
    await mkdir(join(root, 'notes/empty'), { recursive: true }); await writeFile(join(root, 'notes/a.md'), '# A');
    const first = await cli(['stat', 'notes']);
    expect(first.body.data).toMatchObject({ kind: 'folder', fileCount: 1, folderCount: 1 });
    await writeFile(join(root, 'notes/a.md'), '# Updated');
    expect((await cli(['move', 'notes', 'archive', '--if-match', first.body.data.revision])).body.error.code).toBe('CONFLICT');
    const current = (await cli(['stat', 'notes'])).body.data;
    const preview = await cli(['move', 'notes', 'archive', '--dry-run']);
    expect(preview.body.data.revision).toBe(current.revision);
    expect((await cli(['move', 'notes', 'archive', '--if-match', current.revision])).status).toBe(0);
    const moved = (await cli(['stat', 'archive'])).body.data;
    expect(moved.revision).toBe(current.revision);
    expect((await cli(['delete', 'archive', '--recursive', '--if-match', moved.revision])).status).toBe(0);
    expect((await cli(['stat', 'archive'])).body.error.code).toBe('NOT_FOUND');
    expect(await readFile(join(root, '.trash/archive/a.md'), 'utf8')).toBe('# Updated');
  }, 30_000);

  it('inspects explicit projects without changing saved selection, including stale selection and target errors', async () => {
    for (const name of ['alpha', 'beta']) {
      const directory = join(root, 'projects', name);
      await mkdir(join(directory, '.forge'), { recursive: true });
      await writeFile(join(directory, '.forge/project.json'), JSON.stringify({ schemaVersion: 1, name, type: 'library' }));
      await writeFile(join(directory, 'data.txt'), name);
    }
    await mkdir(join(root, 'bin/data'), { recursive: true });
    const selectionPath = join(root, 'bin/data/context.json');
    const selection = JSON.stringify({ schemaVersion: 1, project: 'beta', directory: 'projects/beta' });
    await writeFile(selectionPath, selection);
    const responses = await Promise.all(['alpha', 'beta'].map(project => cli(['stat', 'data.txt', '--project', project])));
    expect(responses.map(result => result.body.data.bytes)).toEqual([5, 4]);
    expect(responses.map(result => result.body.context.project.name)).toEqual(['alpha', 'beta']);
    expect((await cli(['stat', 'data.txt'])).body.context.project.name).toBe('beta');
    expect((await cli(['stat', 'data.txt', '--project', 'missing'])).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await cli(['stat', 'data.txt', '--project', '../alpha'])).body.error.code).toBe('INVALID_PROJECT_NAME');
    expect((await cli(['stat', '../beta/data.txt', '--project', 'alpha'])).body.error.code).toBe('INVALID_PATH');
    await rm(join(root, 'projects/beta/.forge/project.json'));
    expect((await cli(['stat', 'data.txt'])).body.error.code).toBe('STALE_PROJECT_CONTEXT');
    expect((await cli(['stat', 'data.txt', '--project', 'alpha'])).status).toBe(0);
    expect(await readFile(selectionPath, 'utf8')).toBe(selection);
  }, 30_000);
});
