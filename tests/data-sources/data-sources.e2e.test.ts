import { beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const environment = portableCli();
let root: string;
beforeEach(async () => { root = await mkdtemp(join(environment.project, 'data-sources-')); });
const cli = (args: string[], input?: string) => environment.cli(args, input, { root });
const source = (kind: 'rest' | 'json') => `---
schemaVersion: 1
id: requests
kind: ${kind}
model:
  name: Request
  idField: id
  fields:
    id: {type: string}
    title: {type: string, example: Purchase request}
    approved: {type: boolean, example: false}
${kind === 'rest' ? 'rest:\n  baseUrl: https://api.example.com/v1\n  operations:\n    list: {method: GET, path: /requests}\n    get: {method: GET, path: "/requests/{id}"}' : 'json:\n  path: data/requests.json'}
testData: {count: 3}
---
# Purchase requests

Owned by the purchasing team. Test data is synthetic.
`;
async function seed(kind: 'rest' | 'json', directory = 'data-sources') {
  await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, directory, 'requests.md'), source(kind));
}

describe('portable data-source workflow', () => {
  it('discovers definitions, reports source revisions, and transfers original Markdown', async () => {
    expect(cli(['data-sources']).body.data).toMatchObject({ status: 'empty', sources: [] });
    expect(cli(['data-sources', 'init', '--dry-run']).body.events).toEqual([]);
    expect(await readdir(root)).toEqual([]);
    await seed('rest');
    const list = cli(['data-sources', 'list']);
    expect(list.status).toBe(0);
    expect(list.body.data.sources).toEqual([{ id: 'requests', kind: 'rest', model: 'Request', sourcePath: 'data-sources/requests.md', fields: ['approved', 'id', 'title'] }]);
    const inspect = cli(['data-sources', 'inspect', 'requests']);
    expect(inspect.body.data.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(inspect.body.data.description).toContain('synthetic');
    expect(cli(['data-sources', 'validate']).body.data.valid).toBe(true);
    expect(cli(['data-sources', 'export', '--out', 'exchange/nested']).status).toBe(0);
    expect(await readFile(join(root, 'exchange/nested/requests.md'), 'utf8')).toBe(source('rest'));
    expect(cli(['data-sources', 'import', '--from', 'exchange/nested', '--library', 'copied']).status).toBe(0);
    expect(cli(['data-sources', 'import', '--from', 'exchange/nested', '--library', 'copied']).body.error.code).toBe('DUPLICATE_DATA_SOURCE');
  });

  it.each(['rest', 'json'] as const)('generates deterministic %s implementation and valid test data without runtime dependencies', async kind => {
    await seed(kind);
    const args = ['make', 'data-source', 'requests', '--out', 'adapters', '--test-data-out', 'fixtures'];
    const first = cli([...args, '--dry-run']), second = cli([...args, '--dry-run']);
    expect(first.status).toBe(0); expect(second.body.data).toEqual(first.body.data);
    expect(first.body.events).toEqual([]);
    expect(first.body.data.preview.map((file: { path: string }) => file.path).sort()).toEqual(['adapters/requests.ts', 'fixtures/requests.fixtures.json']);
    await expect(readFile(join(root, 'adapters/requests.ts'))).rejects.toThrow();
    expect(cli(args).status).toBe(0);
    const adapter = await readFile(join(root, 'adapters/requests.ts'), 'utf8');
    expect(adapter).toContain('createRequestDataSource');
    expect(adapter).toContain(kind === 'rest' ? 'https://api.example.com/v1' : 'data/requests.json');
    const records = JSON.parse(await readFile(join(root, 'fixtures/requests.fixtures.json'), 'utf8'));
    expect(records).toHaveLength(3);
    expect(new Set(records.map((record: { id: string }) => record.id)).size).toBe(3);
    expect(records[0]).toMatchObject({ title: 'Purchase request', approved: false });
    expect(cli(args).body.error.code).toBe('CONFLICT');
  });

  it('plans and checks drift without mutation, then regenerates only reviewed revisions', async () => {
    await seed('json');
    const args = ['make', 'data-source', 'requests'];
    const missing = cli([...args, '--check']);
    expect(missing.status).toBe(5); expect(missing.body.error.code).toBe('DATA_SOURCE_DRIFT');
    expect(missing.body.events).toEqual([]);
    expect(cli(args).status).toBe(0);
    expect(cli([...args, '--check']).status).toBe(0);
    const path = join(root, 'src/data-sources/requests.ts');
    await writeFile(path, 'user edit\n');
    const planned = cli([...args, '--plan']);
    expect(planned.status).toBe(0);
    expect(planned.body.data.outputs.find((output: { status: string }) => output.status === 'changed').currentContent).toBe('user edit\n');
    expect(planned.body.events).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe('user edit\n');
    expect(cli([...args, '--plan-out', 'review.json']).status).toBe(0);
    await writeFile(path, 'new user edit\n');
    expect(cli([...args, '--revisions-from', 'review.json']).body.error.code).toBe('CONFLICT');
    expect(await readFile(path, 'utf8')).toBe('new user edit\n');
    expect(cli([...args, '--plan-out', 'fresh-review.json']).status).toBe(0);
    expect(cli([...args, '--revisions-from', 'fresh-review.json']).status).toBe(0);
    expect(cli([...args, '--check']).status).toBe(0);
  });

  it('honors configured paths and explicit project scope without changing saved selection', async () => {
    await mkdir(join(root, 'bin'));
    await writeFile(join(root, 'bin/config.json'), JSON.stringify({ paths: {
      dataSources: 'contracts/data', dataGenerated: 'adapters', dataFixtures: 'fixtures', dataImports: 'incoming', dataExports: 'outgoing', projects: 'apps',
    } }));
    await seed('json', 'contracts/data');
    expect(cli(['project', 'create', 'portal']).status).toBe(0);
    expect(cli(['make', 'data-source', 'requests', '--project', 'portal']).status).toBe(0);
    expect(cli(['project', 'current']).body.data.project).toBeNull();
    expect(await readFile(join(root, 'apps/portal/adapters/requests.ts'), 'utf8')).toContain('createRequestDataSource');
    expect(JSON.parse(await readFile(join(root, 'apps/portal/fixtures/requests.fixtures.json'), 'utf8'))).toHaveLength(3);
    expect(cli(['data-sources', 'export']).status).toBe(0);
    expect(await readFile(join(root, 'outgoing/requests.md'), 'utf8')).toBe(source('json'));
    await mkdir(join(root, 'incoming')); await writeFile(join(root, 'incoming/other.md'), source('rest').replace('id: requests', 'id: other'));
    expect(cli(['data-sources', 'import']).status).toBe(0);
    expect(cli(['data-sources', 'list']).body.data.count).toBe(2);
  });

  it('rejects invalid option combinations and escaping paths before writing', async () => {
    await seed('rest');
    for (const args of [
      ['make', 'data-source', 'requests', '--out', '../escape'],
      ['make', 'data-source', 'requests', '--framework', 'react'],
      ['make', 'data-source', 'requests', '--plan', '--check'],
      ['make', 'entity', 'Request', '--test-data-out', 'fixtures'],
      ['data-sources', 'list', '--kind', 'json'],
      ['data-sources', 'create', 'new', '--kind', 'sql'],
    ]) {
      const result = cli(args); expect(result.status, args.join(' ')).not.toBe(0); expect(result.body.events).toEqual([]);
    }
    expect(await readdir(root)).toEqual(['data-sources']);
  });
});
