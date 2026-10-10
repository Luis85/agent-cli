import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SetupService } from '../../src/application/workspace/setup.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import type { AppConfig } from '../../src/application/workspace/config.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { MarkdownTemplates } from '../../src/infrastructure/templates/markdown.ts';
import { readSetupArtifacts } from '../../src/infrastructure/workspace/setup-artifacts.ts';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(dryRun = false) {
  const parent = await mkdtemp(join(tmpdir(), 'forge-setup-')); temporary.push(parent);
  const root = join(parent, 'project'), bundle = join(parent, 'bundle');
  await mkdir(root); await mkdir(bundle);
  await writeFile(join(bundle, 'forge.js'), 'console.log("portable")');
  await writeFile(join(bundle, 'package.json'), '{"type":"commonjs","main":"forge.js"}');
  await mkdir(join(bundle, 'config'));
  await writeFile(join(bundle, 'config/default.json'), '{}\n');
  await mkdir(join(bundle, 'data/docs/reference'), { recursive: true });
  await writeFile(join(bundle, 'data/docs/reference/cli.md'), '# Commands\n');
  await writeFile(join(bundle, 'data/distribution.json'), JSON.stringify({ schemaVersion: 1, files: ['forge.js', 'config/default.json', 'data/distribution.json', 'data/docs/reference/cli.md', 'package.json'] }));
  const config: AppConfig = {
    schemaVersion: 1,
    paths: { projects: 'work/projects', dataSources: 'data-sources', dataGenerated: 'src/data-sources', dataFixtures: 'test-data', dataImports: 'imports/data-sources', dataExports: 'exports/data-sources' },
    settings: { json: true, dryRun: false, language: 'en', events: 'changes' }, templates: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' }, plugins: { enabled: [], disabled: [], settings: {} },
  };
  const files = await NodeFiles.at(root), events = new EventBus(new NodeEventScope());
  for (const id of ['vault.create', 'vault.modify']) events.define({ id, validate: (_v): _v is unknown => true });
  const workspace = new Workspace(files, new ObsidianDocuments(), events, dryRun);
  const artifacts = await readSetupArtifacts(bundle);
  const skills = [{ id: 'forge-workflow', content: '---\nname: forge-workflow\ndescription: Safe workflow\n---\nRead first.\n' }];
  return { root, bundle, config, files, events, workspace, artifacts, skills, setup: new SetupService(workspace, config, artifacts, skills) };
}
it('installs fixed environment directories and configured projects through workspace writes', async () => {
  const { root, setup, events, config } = await fixture();
  const result = await setup.run();
  expect(result.dryRun).toBe(false); expect(result.skipped).toEqual([]); expect(result.changes).toHaveLength(11);
  const installed = JSON.parse(await readFile(join(root, 'bin/config.json'), 'utf8'));
  expect(installed).toEqual(config);
  expect(installed.paths).toEqual(config.paths);
  expect(await readFile(join(root, 'bin/forge.js'), 'utf8')).toContain('portable');
  expect(await readFile(join(root, 'bin/data/docs/reference/cli.md'), 'utf8')).toBe('# Commands\n');
  expect(await readFile(join(root, 'bin/templates/entity.md'), 'utf8')).toContain('{{title}}');
  expect(await readFile(join(root, 'bin/plugins/.gitkeep'))).toHaveLength(0);
  const guidance = await readFile(join(root, 'AGENTS.md'), 'utf8');
  for (const command of ['--if-match', 'node bin/forge.js', 'project open', 'project current', 'project close']) expect(guidance).toContain(command);
  expect(await readdir(join(root, 'bin'))).toEqual(['config', 'config.json', 'data', 'forge.js', 'package.json', 'plugins', 'templates']);
  expect(await readFile(join(root, 'work/projects/.gitkeep'))).toHaveLength(0);
  expect(events.history.filter(record => (record.payload as { kind: string }).kind === 'file')).toHaveLength(11);
  expect(events.history).toHaveLength(23);
});
it('preserves existing configuration, bundle, template, skill and agent instructions on repeated setup', async () => {
  const { root, setup, events } = await fixture();
  await setup.run();
  const edited = ['bin/config.json', 'bin/forge.js', 'bin/templates/entity.md', '.agents/skills/forge-workflow/SKILL.md', 'AGENTS.md'];
  for (const path of edited) await writeFile(join(root, path), `User content for ${path}`);
  const count = events.history.length;
  const result = await setup.run();
  expect(result.changes).toEqual([]); expect(result.skipped).toHaveLength(11);
  expect(events.history).toHaveLength(count);
  for (const path of edited) expect(await readFile(join(root, path), 'utf8')).toBe(`User content for ${path}`);
});
it('previews every new destination without creating directories or publishing events', async () => {
  const { root, setup, events } = await fixture(true);
  const result = await setup.run();
  expect(result.dryRun).toBe(true); expect(result.changes).toHaveLength(11);
  expect(await readdir(root)).toEqual([]); expect(events.history).toEqual([]);
});
it('fills missing setup files while retaining an existing AGENTS.md', async () => {
  const { root, setup } = await fixture();
  await writeFile(join(root, 'AGENTS.md'), 'Existing project instructions');
  const result = await setup.run();
  expect(result.skipped).toEqual(['AGENTS.md']); expect(result.changes).toHaveLength(10);
  expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('Existing project instructions');
});
it('copies only distribution assets and excludes environment data from its fixed snapshot', async () => {
  const { root, bundle } = await fixture();
  await writeFile(join(root, 'private.txt'), 'do not copy');
  await symlink(join(root, 'private.txt'), join(bundle, 'linked-file'));
  await symlink(root, join(bundle, 'linked-directory'));
  await writeFile(join(bundle, 'config.json'), '{"private":"configuration"}');
  await writeFile(join(bundle, 'data/context.json'), '{"activeProject":"private-project"}');
  const artifacts = await readSetupArtifacts(bundle);
  expect(artifacts.map(artifact => artifact.path)).toEqual(['forge.js', 'config/default.json', 'data/distribution.json', 'data/docs/reference/cli.md', 'package.json']);
  await writeFile(join(bundle, 'forge.js'), 'changed after snapshot');
  expect(new TextDecoder().decode(artifacts.find(artifact => artifact.path === 'forge.js')!.bytes)).toContain('portable');
});
it('rejects a distribution asset replaced by a symlink before planning installation', async () => {
  const { root, bundle } = await fixture();
  await writeFile(join(root, 'private.txt'), 'do not copy');
  await rm(join(bundle, 'data/docs/reference/cli.md'));
  await symlink(join(root, 'private.txt'), join(bundle, 'data/docs/reference/cli.md'));
  await expect(readSetupArtifacts(bundle)).rejects.toThrow();
  expect(await readdir(root)).toEqual(['private.txt']);
});
it.each(['missing-defaults', 'duplicate-assets'])('rejects an invalid distribution manifest: %s', async invalid => {
  const { bundle } = await fixture();
  const path = join(bundle, 'data/distribution.json');
  const manifest = JSON.parse(await readFile(path, 'utf8')) as { schemaVersion: number; files: string[] };
  if (invalid === 'missing-defaults') manifest.files = manifest.files.filter(file => file !== 'config/default.json');
  else manifest.files.push('forge.js');
  await writeFile(path, JSON.stringify(manifest));
  await expect(readSetupArtifacts(bundle)).rejects.toMatchObject({ code: 'INVALID_SETUP' });
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
  const source = await readFile(join(root, 'bin/templates/entity.md'));
  const title = "Engineer's Work: Item";
  const rendered = new MarkdownTemplates().render(source, { title, date: '2026-10-07' });
  const codec = new ObsidianDocuments();
  codec.validate('entity.md', rendered);
  expect(codec.inspect('entity.md', rendered)).toMatchObject({ properties: { type: 'entity', title, created: '2026-10-07' } });
  expect(new TextDecoder().decode(rendered)).toContain(`# ${title}`);
});
