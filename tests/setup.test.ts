import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SetupService } from '../src/application/setup.ts';
import { Workspace } from '../src/application/workspace.ts';
import { EventBus } from '../src/application/events.ts';
import type { AppConfig } from '../src/application/config.ts';
import { NodeFiles } from '../src/infrastructure/files.ts';
import { ObsidianDocuments } from '../src/infrastructure/documents.ts';
import { MarkdownTemplates } from '../src/infrastructure/templates.ts';
import { readSetupArtifacts } from '../src/infrastructure/setup-artifacts.ts';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(dryRun = false) {
  const parent = await mkdtemp(join(tmpdir(), 'forge-setup-')); temporary.push(parent);
  const root = join(parent, 'project'), bundle = join(parent, 'bundle');
  await mkdir(root); await mkdir(bundle);
  await writeFile(join(bundle, 'app.cjs'), 'console.log("portable")');
  await writeFile(join(bundle, 'package.json'), '{"main":"app.cjs"}');
  await mkdir(join(bundle, 'docs'));
  await writeFile(join(bundle, 'docs/cli.md'), '# Commands\n');
  const config: AppConfig = {
    schemaVersion: 1,
    paths: { root, templates: 'resources/templates', output: 'notes', generated: 'src/domain', plugins: 'extensions', skills: '.agents/skills', projects: 'work/projects' },
    settings: { json: true, dryRun: false }, templates: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' }, plugins: { enabled: [] },
  };
  const files = await NodeFiles.at(root), events = new EventBus();
  for (const id of ['file.created', 'file.updated']) events.define({ id, validate: (_v): _v is unknown => true });
  const workspace = new Workspace(files, new ObsidianDocuments(), events, dryRun);
  const artifacts = await readSetupArtifacts(bundle);
  const skills = [{ id: 'forge-workflow', content: '---\nname: forge-workflow\ndescription: Safe workflow\n---\nRead first.\n' }];
  return { root, bundle, config, files, events, workspace, artifacts, skills, setup: new SetupService(workspace, config, artifacts, skills) };
}
it('installs a portable bundle and configured project resources through workspace writes', async () => {
  const { root, setup, events, config } = await fixture();
  const result = await setup.run();
  expect(result.dryRun).toBe(false); expect(result.skipped).toEqual([]); expect(result.changes).toHaveLength(8);
  const installed = JSON.parse(await readFile(join(root, 'bin/config.json'), 'utf8'));
  expect(installed).toEqual({ ...config, paths: { ...config.paths, root: '..' } });
  expect(await readFile(join(root, 'bin/app/app.cjs'), 'utf8')).toContain('portable');
  expect(await readFile(join(root, 'bin/app/docs/cli.md'), 'utf8')).toBe('# Commands\n');
  expect(await readFile(join(root, 'resources/templates/entity.md'), 'utf8')).toContain('{{title}}');
  expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('--if-match');
  expect(await readFile(join(root, 'work/projects/.gitkeep'))).toHaveLength(0);
  expect(events.history).toHaveLength(8);
});
it('preserves existing configuration, bundle, template, skill and agent instructions on repeated setup', async () => {
  const { root, setup, events } = await fixture();
  await setup.run();
  const edited = ['bin/config.json', 'bin/app/app.cjs', 'resources/templates/entity.md', '.agents/skills/forge-workflow/SKILL.md', 'AGENTS.md'];
  for (const path of edited) await writeFile(join(root, path), `User content for ${path}`);
  const count = events.history.length;
  const result = await setup.run();
  expect(result.changes).toEqual([]); expect(result.skipped).toHaveLength(8);
  expect(events.history).toHaveLength(count);
  for (const path of edited) expect(await readFile(join(root, path), 'utf8')).toBe(`User content for ${path}`);
});
it('previews every new destination without creating directories or publishing events', async () => {
  const { root, setup, events } = await fixture(true);
  const result = await setup.run();
  expect(result.dryRun).toBe(true); expect(result.changes).toHaveLength(8);
  expect(await readdir(root)).toEqual([]); expect(events.history).toEqual([]);
});
it('fills missing setup files while retaining an existing AGENTS.md', async () => {
  const { root, setup } = await fixture();
  await writeFile(join(root, 'AGENTS.md'), 'Existing project instructions');
  const result = await setup.run();
  expect(result.skipped).toEqual(['AGENTS.md']); expect(result.changes).toHaveLength(7);
  expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('Existing project instructions');
});
it('excludes symlink files and directories from its fixed source snapshot', async () => {
  const { root, bundle } = await fixture();
  await writeFile(join(root, 'private.txt'), 'do not copy');
  await symlink(join(root, 'private.txt'), join(bundle, 'linked-file'));
  await symlink(root, join(bundle, 'linked-directory'));
  const artifacts = await readSetupArtifacts(bundle);
  expect(artifacts.map(artifact => artifact.path)).toEqual(['app.cjs', 'docs/cli.md', 'package.json']);
  await writeFile(join(bundle, 'app.cjs'), 'changed after snapshot');
  expect(new TextDecoder().decode(artifacts.find(artifact => artifact.path === 'app.cjs')!.bytes)).toContain('portable');
});
it('fails safely on destination symlinks instead of treating access errors as missing files', async () => {
  const { root, bundle, setup, events } = await fixture();
  await symlink(bundle, join(root, 'bin'));
  await expect(setup.run()).rejects.toThrowError(expect.objectContaining({ code: 'UNSAFE_PATH' }));
  expect(events.history).toEqual([]); expect(await readdir(root)).toEqual(['bin']);
});
it('rejects incomplete distributions and overlapping setup destinations before any write', async () => {
  const { root, workspace, config, artifacts, skills } = await fixture();
  await expect(new SetupService(workspace, config, [], skills).run()).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_SETUP' }));
  await expect(new SetupService(workspace, config, [...artifacts, artifacts[0]!], skills).run()).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_SETUP' }));
  expect(await readdir(root)).toEqual([]);
});

it('installs a frontmatter and Markdown template that renders arbitrary titles as YAML data', async () => {
  const { root, setup } = await fixture();
  await setup.run();
  const source = await readFile(join(root, 'resources/templates/entity.md'));
  const title = "Engineer's Work: Item";
  const rendered = new MarkdownTemplates().render(source, { title, date: '2026-10-07' });
  const codec = new ObsidianDocuments();
  codec.validate('entity.md', rendered);
  expect(codec.inspect('entity.md', rendered)).toMatchObject({ properties: { type: 'entity', title, created: '2026-10-07' } });
  expect(new TextDecoder().decode(rendered)).toContain(`# ${title}`);
});
