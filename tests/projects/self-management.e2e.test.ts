import { beforeAll, describe, expect, it } from 'vitest';
import { copyFile, cp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { committedEvents } from '../support/events.ts';

const generic = portableCli();
const checkout = portableCli();
let selected: string;
beforeAll(async () => {
  // Restore the checked-in checkout settings only in this private fixture.
  // Include real source and marker, so repository scope is exercised end to end.
  await copyFile(resolve('bin/config.json'), join(checkout.bundle, 'bin/config.json'));
  await copyFile(resolve('bin/data/context.json'), join(checkout.bundle, 'bin/data/context.json'));
  await cp(resolve('src/the-forge'), join(checkout.bundle, 'src/the-forge'), { recursive: true });
  selected = join(checkout.bundle, 'src/the-forge');
});
const cli = (args: string[]) => checkout.cli(args, undefined, { root: null });

describe('repository self-management defaults', () => {
  it('selects its own source project from the executable location even when invoked elsewhere', async () => {
    const config = cli(['config']);
    expect(config.status).toBe(0);
    expect(config.body.data).toMatchObject({ root: checkout.bundle, config: { paths: { projects: 'src' } } });
    const project = { schemaVersion: 1, name: 'the-forge', type: 'library', directory: 'src/the-forge' };
    expect(cli(['project', 'list']).body.data.projects).toEqual([project]);
    expect(cli(['project', 'current']).body.data.project).toEqual(project);
    const source = cli(['read', 'main.ts']);
    expect(source.status).toBe(0);
    expect(source.body.context).toMatchObject({ workspaceRoot: checkout.bundle, root: selected, project });
    expect(Buffer.from(source.body.data.document.content, 'base64')).toEqual(await readFile(join(selected, 'main.ts')));
  });

  it('previews and commits only inside its selected source tree with the normal revision guards', async () => {
    const path = 'notes/self-management.md';
    const input = ['write', path, '--content', '# Managed by the repository CLI'];
    const preview = cli([...input, '--dry-run']);
    expect(preview.status).toBe(0);
    expect(preview.body.context.root).toBe(selected);
    expect(preview.body.data).toMatchObject({ dryRun: true, changes: [{ path, operation: 'created' }] });
    expect(committedEvents(preview.body.events)).toEqual([]);
    await expect(readFile(join(selected, path))).rejects.toMatchObject({ code: 'ENOENT' });
    const written = cli(input);
    expect(written.status).toBe(0);
    expect(await readFile(join(selected, path), 'utf8')).toBe('# Managed by the repository CLI');
    await expect(readFile(join(checkout.bundle, path))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(cli(input).body.error.code).toBe('CONFLICT');
    const revision = written.body.data.changes[0].revision;
    expect(cli(['write', path, '--content', '# Reviewed', '--if-match', revision]).status).toBe(0);
    expect(await readFile(join(selected, path), 'utf8')).toBe('# Reviewed');
    const generation = ['make', 'entity', 'SelfManaged', '--out', 'domain/generated'];
    expect(cli([...generation, '--dry-run']).status).toBe(0);
    await expect(readFile(join(selected, 'domain/generated/self-managed.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(cli(generation).status).toBe(0);
    expect(await readFile(join(selected, 'domain/generated/self-managed.ts'), 'utf8')).toContain('class SelfManaged');
  }, 60_000);

  it('respects explicit project closure instead of silently restoring the checkout default', async () => {
    expect(cli(['project', 'close']).status).toBe(0);
    expect(cli(['project', 'current']).body.data.project).toBeNull();
    const source = cli(['read', 'src/the-forge/main.ts']);
    expect(source.status).toBe(0);
    expect(source.body.context).toMatchObject({ root: checkout.bundle, project: null });
    // Setup preserves the user's explicit selection state; it does not reset defaults.
    expect(cli(['setup']).status).toBe(0);
    expect(cli(['project', 'current']).body.data.project).toBeNull();
    expect(JSON.parse(await readFile(join(checkout.bundle, 'bin/data/context.json'), 'utf8'))).toEqual({ schemaVersion: 1, project: null });
    expect(cli(['project', 'open', 'the-forge']).status).toBe(0);
    expect(cli(['read', 'main.ts']).body.context.root).toBe(selected);
  }, 60_000);

  it('keeps generic copied distributions independent of repository settings and selection', async () => {
    const config = generic.cli(['config'], undefined, { root: null });
    expect(config.status).toBe(0);
    expect(config.body.data.config.paths.projects).toBe('projects');
    expect(generic.cli(['project', 'current'], undefined, { root: null }).body.data.project).toBeNull();
    await expect(readFile(join(generic.bundle, 'bin/data/context.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const manifest = JSON.parse(await readFile(join(generic.bundle, 'bin/data/distribution.json'), 'utf8')) as { files: string[] };
    expect(manifest.files).not.toContain('data/context.json');
    expect(manifest.files).not.toContain('config.json');
    expect(JSON.parse(await readFile(join(generic.bundle, 'bin/config/default.json'), 'utf8')).paths.projects).toBe('projects');
  });
});
