import { beforeAll, describe, expect, it } from 'vitest';
import { copyFile, cp, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { committedEvents } from '../support/events.ts';
import { workspaceRoot } from '../support/workspace.ts';

const generic = portableCli();
const checkout = portableCli();
let selected: string;
beforeAll(async () => {
  // Restore the checked-in checkout settings only in this private fixture.
  // Include the real project, source and marker, so repository scope is exercised end to end.
  await copyFile(join(workspaceRoot, 'bin/config.json'), join(checkout.bundle, 'bin/config.json'));
  await copyFile(join(workspaceRoot, 'bin/data/context.json'), join(checkout.bundle, 'bin/data/context.json'));
  const local = new Set(['node_modules', '.quality-reports', 'release']);
  await cp(join(workspaceRoot, 'src/the-forge'), join(checkout.bundle, 'src/the-forge'), { recursive: true, filter: source => !local.has(basename(source)) });
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
    const source = cli(['read', 'src/main.ts']);
    expect(source.status).toBe(0);
    expect(source.body.context).toMatchObject({ workspaceRoot: checkout.bundle, root: selected, project });
    expect(source.body.data.document).toEqual({ kind: 'text', content: await readFile(join(selected, 'src/main.ts'), 'utf8') });
  });

  it('passes the strict vault check of its selected source project with the tracked ignore globs', () => {
    const checked = cli(['vault', 'check', '--strict']);
    expect(checked.body.error).toBeUndefined();
    expect(checked.body.context.root).toBe(selected);
    expect(checked.body.data.summary).toMatchObject({ error: 0 });
    expect(checked.body.data.summary.files).toBeGreaterThan(100);
  }, 60_000);

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
    const generation = ['make', 'entity', 'SelfManaged', '--out', 'src/domain/generated'];
    expect(cli([...generation, '--dry-run']).status).toBe(0);
    await expect(readFile(join(selected, 'src/domain/generated/self-managed.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(cli(generation).status).toBe(0);
    expect(await readFile(join(selected, 'src/domain/generated/self-managed.ts'), 'utf8')).toContain('class SelfManaged');
  }, 60_000);

  it('respects explicit project closure instead of silently restoring the checkout default', async () => {
    expect(cli(['project', 'close']).status).toBe(0);
    expect(cli(['project', 'current']).body.data.project).toBeNull();
    const source = cli(['read', 'src/the-forge/src/main.ts']);
    expect(source.status).toBe(0);
    expect(source.body.context).toMatchObject({ root: checkout.bundle, project: null });
    // Setup preserves the user's explicit selection state; it does not reset defaults.
    expect(cli(['setup']).status).toBe(0);
    expect(cli(['project', 'current']).body.data.project).toBeNull();
    expect(JSON.parse(await readFile(join(checkout.bundle, 'bin/data/context.json'), 'utf8'))).toEqual({ schemaVersion: 1, project: null });
    expect(cli(['project', 'open', 'the-forge']).status).toBe(0);
    expect(cli(['read', 'src/main.ts']).body.context.root).toBe(selected);
  }, 60_000);

  it('keeps generic copied distributions independent of repository settings and selection', async () => {
    const config = generic.cli(['config'], undefined, { root: null });
    expect(config.status).toBe(0);
    expect(config.body.data.config.paths.projects).toBe('projects');
    expect(config.body.data.config.plugins.settings['vault-check']).toMatchObject({ ignore: [] });
    expect(generic.cli(['project', 'current'], undefined, { root: null }).body.data.project).toBeNull();
    await expect(readFile(join(generic.bundle, 'bin/data/context.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const manifest = JSON.parse(await readFile(join(generic.bundle, 'bin/data/distribution.json'), 'utf8')) as { files: string[] };
    expect(manifest.files).not.toContain('data/context.json');
    expect(manifest.files).not.toContain('config.json');
    expect(JSON.parse(await readFile(join(generic.bundle, 'bin/config/default.json'), 'utf8')).paths.projects).toBe('projects');
  });
});
