import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { nativeFormats } from '../src/domain/file.ts';
let project: string, bundle: string;
beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'agent-cli-project-'));
  bundle = await mkdtemp(join(tmpdir(), 'agent-cli-bundle-'));
  await cp(resolve('bin/app'), join(bundle, 'app'), { recursive: true });
  await writeFile(join(bundle, 'package.json'), '{"type":"module"}');
});
afterAll(async () => { await rm(project, { recursive: true, force: true }); await rm(bundle, { recursive: true, force: true }); });
function cli(args: string[], input?: string | Buffer, invocation: { root?: string | null; entry?: string; cwd?: string } = {}) {
  const root = invocation.root === undefined ? project : invocation.root;
  const result = spawnSync(process.execPath, [invocation.entry ?? join(bundle, 'app'), ...(root === null ? [] : ['--root', root]), '--json', ...args], { cwd: invocation.cwd ?? project, encoding: 'utf8', input, timeout: 10000, env: { ...process.env, NODE_PATH: '' } });
  expect(result.error).toBeUndefined(); expect(result.stderr).toBe('');
  return { status: result.status, body: JSON.parse(result.stdout), stdout: result.stdout };
}
describe('portable CLI without installed dependencies', () => {
  it('discovers commands, help and global options from any working directory', () => {
    const { status, body } = cli(['schema']);
    expect(status).toBe(0); expect(body.ok).toBe(true); expect(body.data.name).toBe('The Forge');
    expect(body.data.commands.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['make', 'setup', 'config', 'project', 'templates']));
    expect(cli(['make', '--help']).body.data.usage).toContain('generator');
    expect(cli(['--version']).body.data.version).toBe('0.1.0');
  });
  it('rejects unknown commands/options and missing values with machine-readable errors', () => {
    for (const args of [['nonsense'], ['init'], ['--plugins', 'plugins.json', 'help'], ['read', 'a.md', '--typo'], ['write', 'a.md', '--content'], ['read'], ['read', 'a.md', '--json']]) {
      const result = cli(args); expect(result.status).not.toBe(0); expect(result.body.ok).toBe(false); expect(result.body.error.code).toBeTypeOf('string');
    }
    expect(cli(['read', 'missing.md']).status).toBe(3);
  });
  it('previews generation without side effects and refuses generator overwrite', async () => {
    const preview = cli(['make', 'entity', 'Task', '--out', 'domain', '--dry-run']);
    expect(preview.body.data.preview[0].content).toContain('class Task'); expect(preview.body.events).toEqual([]);
    await expect(readFile(join(project, 'domain/task.ts'))).rejects.toThrow();
    expect(cli(['make', 'entity', 'Task', '--out', 'domain']).status).toBe(0);
    expect(cli(['make', 'entity', 'Task', '--out', 'domain']).body.error.code).toBe('CONFLICT');
    expect(cli(['make', 'entity', '../Task']).body.error.code).toBe('INVALID_NAME');
  });
  it('creates and edits notes with guarded revisions, shell-safe stdin and literal replacement', async () => {
    const source = '---\nstatus: draft\n---\n# Task\nBody $HOME `literal`\n';
    expect(cli(['create', 'notes/task.md', '--stdin'], source).status).toBe(0);
    const before = cli(['read', 'notes/task.md']).body.data;
    expect(cli(['properties', 'notes/task.md', '--set', '{"status":"done"}', '--if-match', before.revision, '--dry-run']).body.events).toEqual([]);
    const update = cli(['properties', 'notes/task.md', '--set', '{"status":"done"}', '--if-match', before.revision]);
    expect(update.status).toBe(0); expect(update.body.events[0].id).toBe('file.updated');
    expect(cli(['edit', 'notes/task.md', '--append', '--content', 'stale', '--if-match', before.revision]).body.error.code).toBe('CONFLICT');
    const current = cli(['read', 'notes/task.md']).body.data;
    expect(cli(['edit', 'notes/task.md', '--find', 'Body', '--replace', '$& literal', '--if-match', current.revision]).status).toBe(0);
    expect(await readFile(join(project, 'notes/task.md'), 'utf8')).toContain('$& literal $HOME `literal`');
  });
  it('creates and patches valid Canvas and Base documents', () => {
    for (const path of ['plan.canvas', 'tasks.base']) expect(cli(['create', path]).status).toBe(0);
    const canvas = cli(['read', 'plan.canvas']).body.data;
    expect(cli(['patch', 'plan.canvas', '--pointer', '/nodes/-', '--value', '{"id":"a","type":"text","x":0,"y":0,"width":100,"height":100,"text":"Task"}', '--if-match', canvas.revision]).status).toBe(0);
    const base = cli(['read', 'tasks.base']).body.data;
    expect(cli(['patch', 'tasks.base', '--pointer', '/views/0/name', '--value', '"Tasks"', '--if-match', base.revision]).status).toBe(0);
    expect(cli(['validate', 'tasks.base']).body.data.valid).toBe(true);
  });
  const extensions = [...new Set(Object.entries(nativeFormats).filter(([key]) => !['markdown', 'canvas', 'base'].includes(key)).flatMap(([, ext]) => [...ext]))];
  it.each(extensions)('round trips .%s attachments without byte loss', extension => {
    const bytes = Buffer.from([0, 255, 12, 0, 193, 128, 42]);
    const path = `assets/sample.${extension}`;
    expect(cli(['write', path, '--stdin'], bytes).status).toBe(0);
    const read = cli(['read', path]).body.data;
    expect(Buffer.from(read.document.content, 'base64')).toEqual(bytes);
    expect(cli(['write', path, '--content', 'AQID', '--encoding', 'base64', '--if-match', read.revision]).status).toBe(0);
    expect(cli(['read', path]).body.data.document.content).toBe('AQID');
  });
  it('loads runtime plugins, generators, skills and event subscriptions from a portable bundle', async () => {
    await mkdir(join(project, 'plugins/quality'), { recursive: true });
    await writeFile(join(project, 'plugins/quality/manifest.json'), JSON.stringify({ id: 'quality', name: 'Quality', version: '1.0.0', minAppVersion: '0.1.0', description: 'Quality fixture', author: 'Tests' }));
    await writeFile(join(project, 'plugins/quality/main.mjs'), `export default {
      events: [{ id: 'quality.checked', validate: p => typeof p === 'string' }],
      commands: [{ id: 'quality.check', description: 'Check', usage: 'quality.check --label text', options: { label: 'string' }, async run(args, flags, ctx) { await ctx.events.emit('quality.checked', flags.label); return { label: flags.label }; } }],
      generators: [{ id: 'quality.fixture', description: 'Fixture', generate(name, out) { return [{ path: out + '/' + name + '.md', bytes: new TextEncoder().encode('# Fixture') }]; } }],
      skills: [{ id: 'quality.review', content: 'Review a change.' }],
      onload(ctx) { this.context = ctx; ctx.events.on('file.created', () => { throw new Error('Observer failed'); }); },
      onunload() { this.context.events.warn('cleaned up'); }
    };`);
    const pluginConfig = join(project, 'plugin-config.json');
    await writeFile(pluginConfig, JSON.stringify({ paths: { root: project, plugins: 'plugins' }, plugins: { enabled: ['quality'] } }));
    const args = ['--config', pluginConfig];
    const check = cli([...args, 'quality.check', '--label', 'ready']);
    expect(check.status).toBe(0); expect(check.body.data.label).toBe('ready'); expect(check.body.events[0].id).toBe('quality.checked'); expect(check.body.warnings).toContain('cleaned up');
    const generated = cli([...args, 'make', 'quality.fixture', 'Example', '--out', 'fixtures']);
    expect(generated.status).toBe(0); expect(generated.body.warnings.some((w: string) => w.includes('Observer failed'))).toBe(true);
    expect(await readFile(join(project, 'fixtures/Example.md'), 'utf8')).toBe('# Fixture');
    expect(cli([...args, 'skills', 'show', 'quality.review']).body.data.content).toBe('Review a change.');
    const discovery = cli([...args, 'schema']);
    expect(discovery.status).toBe(0); expect(discovery.body.warnings).toEqual([]);
    expect(discovery.body.data.commands.map((command: { id: string }) => command.id)).toContain('quality.check');
    expect(cli([...args, '--no-plugins', 'quality.check']).body.error.code).toBe('UNKNOWN_COMMAND');
    expect(cli(['quality.check']).body.error.code).toBe('UNKNOWN_COMMAND');
  });
  it('installs embedded skills from the copied bundle', async () => {
    expect(cli(['skills', 'install']).status).toBe(0);
    expect(await readFile(join(project, '.agents/skills/forge-workflow/SKILL.md'), 'utf8')).toContain('CONFLICT');
    expect(cli(['skills', 'install']).body.error.code).toBe('CONFLICT');
  });

  it('uses validated configuration paths and allows explicit invocation overrides', async () => {
    const configuredRoot = join(project, 'configured-workspace');
    await mkdir(configuredRoot);
    const config = join(project, 'configured.json');
    await writeFile(config, JSON.stringify({ paths: { root: 'configured-workspace', generated: 'generated/models' }, settings: { dryRun: true, json: true } }));
    const args = ['--config', config];
    const loaded = cli([...args, 'config'], undefined, { root: null, cwd: bundle });
    expect(loaded.status).toBe(0);
    expect(loaded.body.data.config.paths.root).toBe(configuredRoot);
    expect(loaded.body.data.path).toBe(config);
    const preview = cli([...args, 'make', 'entity', 'ConfiguredItem'], undefined, { root: null });
    expect(preview.status).toBe(0); expect(preview.body.data.dryRun).toBe(true); expect(preview.body.events).toEqual([]);
    expect(await readdir(configuredRoot)).toEqual([]);
    expect(cli([...args, '--no-dry-run', 'make', 'entity', 'ConfiguredItem'], undefined, { root: null }).status).toBe(0);
    expect(await readFile(join(configuredRoot, 'generated/models/configured-item.ts'), 'utf8')).toContain('class ConfiguredItem');
    expect(cli([...args, 'config']).body.data.config.paths.root).toBe(project);
    for (const invalid of [{ settings: { dryrun: true } }, { paths: { templates: '../outside' } }, { plugins: { enabled: ['same', 'same'] } }, { unknown: true }]) {
      await writeFile(config, JSON.stringify(invalid));
      expect(cli([...args, 'config']).body.error.code).toBe('INVALID_CONFIG');
    }
    expect(cli(['--config', join(project, 'absent-config.json'), 'config']).body.error.code).toBe('INVALID_CONFIG');
  });

  it('treats flag-shaped command values as literal data without overriding configured dry runs or routing', async () => {
    const isolated = join(project, 'literal-values-workspace');
    await mkdir(isolated);
    const config = join(project, 'literal-values-config.json');
    await writeFile(config, JSON.stringify({ paths: { root: isolated }, settings: { dryRun: true } }));
    const args = ['--config', config];
    const invocation = { root: null };
    for (const literal of ['--no-dry-run', '--root', '--config', '--version', '--no-plugins', '--help', '--json']) {
      const result = cli([...args, 'create', 'preview.md', '--content', literal], undefined, invocation);
      expect(result.status, literal).toBe(0);
      expect(result.body.data.dryRun, literal).toBe(true);
      expect(result.body.data.changes[0]).toMatchObject({ path: 'preview.md', bytes: Buffer.byteLength(literal), revision: createHash('sha256').update(literal).digest('hex') });
      expect(result.body.events, literal).toEqual([]);
      expect(await readdir(isolated)).toEqual([]);
    }
    const committed = cli([...args, 'create', 'literal.md', '--content', '--version', '--no-dry-run'], undefined, invocation);
    expect(committed.status).toBe(0); expect(committed.body.data.dryRun).toBe(false);
    expect(committed.body.events).toHaveLength(1);
    expect(await readFile(join(isolated, 'literal.md'), 'utf8')).toBe('--version');
    const lateRouting = cli([...args, 'create', 'late-routing.md', '--content', 'text', '--no-dry-run', '--root', project], undefined, invocation);
    expect(lateRouting.status).not.toBe(0); expect(lateRouting.body.events).toEqual([]);
    await expect(readFile(join(isolated, 'late-routing.md'))).rejects.toThrow();
    await expect(readFile(join(project, 'late-routing.md'))).rejects.toThrow();
  });

  it('renders discovered Obsidian templates using typed values, configured paths and guarded creation', async () => {
    await mkdir(join(project, 'obsidian-templates'));
    const template = '---\ntitle: {{title}}\ncreated: {{date}}\ntags: {{tags}}\nsummary: "{{summary}}"\n---\n# {{title}}\n\n[[Architecture]]\n> [!tip]\n> {{summary}}\n';
    await writeFile(join(project, 'obsidian-templates/entity.md'), template);
    const config = join(project, 'templates-config.json');
    await writeFile(config, JSON.stringify({ paths: { root: project, templates: 'obsidian-templates', output: 'documents' }, templates: { dateFormat: 'YYYY/MM/DD' } }));
    const args = ['--config', config];
    expect(cli([...args, 'templates', 'list']).body.data.templates).toEqual(['entity.md']);
    expect(cli([...args, 'templates', 'inspect', 'entity.md']).body.data.variables).toEqual(['date', 'summary', 'tags', 'title']);
    const values = { tags: ['entity', 'domain'], summary: 'Quoted: value\nextra: true' };
    await writeFile(join(project, 'template-values.json'), JSON.stringify(values));
    const make = [...args, 'make', 'document', 'Work Item', '--template', 'entity.md', '--values-from', 'template-values.json', '--date', '2026-10-07T14:05:00Z'];
    const preview = cli([...make, '--dry-run']);
    expect(preview.status).toBe(0); expect(preview.body.events).toEqual([]);
    expect(preview.body.data.preview[0].path).toBe('documents/Work Item.md');
    await expect(readFile(join(project, 'documents/Work Item.md'))).rejects.toThrow();
    expect(cli(make).status).toBe(0);
    const read = cli(['read', 'documents/Work Item.md']).body.data.document;
    expect(read.properties).toEqual({ title: 'Work Item', created: '2026/10/07', tags: values.tags, summary: values.summary });
    expect(read.body).toContain('[[Architecture]]\n> [!tip]');
    expect(cli(make).body.error.code).toBe('CONFLICT');
    expect(cli([...args, 'make', 'document', 'Missing', '--template', 'entity.md']).body.error.code).toBe('UNKNOWN_TEMPLATE_VARIABLE');
    expect(cli([...make, '--values', '{}']).body.error.code).toBe('INVALID_INPUT');
    expect(cli([...args, 'make', 'document', '../Escape', '--template', 'entity.md']).body.error.code).toBe('INVALID_NAME');
    expect(cli([...args, 'templates', 'inspect', '../template-values.json']).status).not.toBe(0);
  });

  it('creates discoverable library projects and tested components in the configured directory', async () => {
    const config = join(project, 'projects-config.json');
    await writeFile(config, JSON.stringify({ paths: { root: project, projects: 'src' } }));
    const args = ['--config', config];
    expect(cli([...args, 'project', 'list']).body.data.projects).toEqual([]);
    const preview = cli([...args, 'project', 'create', 'task-lib', '--dry-run']);
    expect(preview.status).toBe(0); expect(preview.body.events).toEqual([]);
    await expect(readFile(join(project, 'src/task-lib/package.json'))).rejects.toThrow();
    expect(cli([...args, 'project', 'create', 'task-lib']).status).toBe(0);
    const manifest = JSON.parse(await readFile(join(project, 'src/task-lib/package.json'), 'utf8'));
    expect(manifest).toMatchObject({ name: 'task-lib', scripts: { check: 'npm run typecheck && npm run build && npm test' }, devDependencies: { vite: expect.any(String), vitest: expect.any(String), typescript: expect.any(String) } });
    expect(cli([...args, 'project', 'list']).body.data.projects).toEqual([{ schemaVersion: 1, name: 'task-lib', type: 'library', directory: 'src/task-lib' }]);
    expect(cli([...args, 'project', 'inspect', 'task-lib']).body.data.directory).toBe('src/task-lib');
    expect(cli([...args, 'project', 'component', 'task-lib', 'WorkItem', '--dry-run']).body.events).toEqual([]);
    await expect(readFile(join(project, 'src/task-lib/src/domain/work-item.ts'))).rejects.toThrow();
    expect(cli([...args, 'project', 'component', 'task-lib', 'WorkItem']).status).toBe(0);
    expect(await readFile(join(project, 'src/task-lib/tests/work-item.domain.test.ts'), 'utf8')).toContain('rejects an empty identity');
    expect(cli([...args, 'project', 'component', 'task-lib', 'FindItem', '--kind', 'application']).status).toBe(0);
    expect(await readFile(join(project, 'src/task-lib/src/application/find-item.ts'), 'utf8')).toContain('FindItemRepository');
    expect(cli([...args, 'project', 'component', 'task-lib', 'WorkItem']).body.error.code).toBe('CONFLICT');
    expect(cli([...args, 'project', 'create', 'task-lib']).body.error.code).toBe('PROJECT_EXISTS');
    expect(cli([...args, 'project', 'inspect', 'absent']).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect(cli([...args, 'project', 'create', '../escape']).body.error.code).toBe('INVALID_PROJECT_NAME');
    expect(cli([...args, 'project', 'component', 'task-lib', 'Other', '--kind', 'infrastructure']).body.error.code).toBe('INVALID_ARGUMENT');
  });

  it('sets up a portable installation idempotently while preserving user-owned files', async () => {
    const installation = join(project, 'installed-workspace');
    await mkdir(installation);
    await writeFile(join(installation, 'AGENTS.md'), '# Existing engineering process\n');
    const invocation = { root: installation };
    const preview = cli(['setup', '--dry-run'], undefined, invocation);
    expect(preview.status).toBe(0); expect(preview.body.events).toEqual([]);
    expect(preview.body.data.skipped).toContain('AGENTS.md');
    expect(await readdir(installation)).toEqual(['AGENTS.md']);
    const setup = cli(['setup'], undefined, invocation);
    expect(setup.status).toBe(0); expect(setup.body.events.length).toBeGreaterThan(0);
    expect(await readFile(join(installation, 'AGENTS.md'), 'utf8')).toBe('# Existing engineering process\n');
    expect(JSON.parse(await readFile(join(installation, 'bin/config.json'), 'utf8')).paths.root).toBe('..');
    expect(await readFile(join(installation, '.agents/skills/forge-workflow/SKILL.md'), 'utf8')).toContain('CONFLICT');
    expect(await readFile(join(installation, 'templates/entity.md'), 'utf8')).toContain('{{title}}');
    const repeated = cli(['setup'], undefined, invocation);
    expect(repeated.status).toBe(0); expect(repeated.body.data.changes).toEqual([]); expect(repeated.body.events).toEqual([]);
    const installed = { entry: join(installation, 'bin/app'), root: null, cwd: bundle };
    const config = cli(['config'], undefined, installed);
    expect(config.status).toBe(0); expect(config.body.data.config.paths.root).toBe(installation);
    expect(cli(['make', 'document', 'Installed Entity', '--template', 'entity.md', '--date', '2026-10-07'], undefined, installed).status).toBe(0);
    expect(await readFile(join(installation, 'notes/Installed Entity.md'), 'utf8')).toContain('# Installed Entity');
  });
});
