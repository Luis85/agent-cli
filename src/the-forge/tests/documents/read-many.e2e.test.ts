import { expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const harness = portableCli();
it('reads an explicit project without changing selection and fails without partial data', async () => {
  const { cli } = harness;
  expect((await cli(['setup'])).body.ok).toBe(true);
  for (const project of ['first', 'second']) {
    expect((await cli(['project', 'create', project])).body.ok).toBe(true);
    await writeFile(join(harness.project, 'projects', project, 'note.txt'), project);
    await writeFile(join(harness.project, 'projects', project, 'note.md'), `# ${project}\n`);
  }
  expect((await cli(['project', 'open', 'first'])).body.ok).toBe(true);
  const bundle = await cli(['read-many', 'note.md', 'note.txt', '--project', 'second']);
  expect(bundle.status).toBe(0);
  expect(bundle.body.context.project.name).toBe('second');
  expect(bundle.body.data.files.map((file: { path: string }) => file.path)).toEqual(['note.md', 'note.txt']);
  expect(bundle.body.data.files[1].document.content).toBe('second');
  for (const file of bundle.body.data.files) {
    expect((await cli(['read', file.path, '--project', 'second'])).body.data).toEqual(file);
  }
  expect((await cli(['project', 'current'])).body.data.project.name).toBe('first');
  const failed = await cli(['read-many', 'note.txt', 'missing.txt', '--project', 'second']);
  expect(failed.status).not.toBe(0);
  expect(failed.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', details: { index: 1, path: 'missing.txt' } } });
  expect(failed.body.data).toBeUndefined();
  expect((await cli(['project', 'current'])).body.data.project.name).toBe('first');
});
