import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from './support/portable-cli.ts';
const fixture = portableCli();
const cli = fixture.cli;
let project: string, bundle: string;
beforeAll(() => { project = fixture.project; bundle = fixture.bundle; });
import { createHash } from 'node:crypto';
import { nativeFormats } from '../src/domain/file.ts';
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
  it('rejects unsupported file kinds instead of reporting an empty workspace', async () => {
    await writeFile(join(project, 'kind-filter.md'), '# Discoverable note\n');
    const invalid = cli(['list', '--kind', 'markdon']);
    expect(invalid.status).toBe(2);
    expect(invalid.body.error).toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('markdown') });
    const valid = cli(['list', '--kind', 'markdown']);
    expect(valid.status).toBe(0);
    expect(valid.body.data.files).toContainEqual({ path: 'kind-filter.md', kind: 'markdown' });
  });
  it.each([
    ['make', '--out', 'ignored'],
    ['make', '--template', 'entity.md'],
    ['make', '--values', '{}'],
    ['make', '--values-from', 'inputs.json'],
    ['make', '--date', '2026-10-07'],
    ['skills', '--out', 'ignored'],
    ['skills', 'list', '--out', 'ignored'],
    ['skills', 'show', 'forge-workflow', '--out', 'ignored'],
  ])('rejects inapplicable generation or installation options: %j', (...args) => {
    const result = cli(args);
    expect(result.status).toBe(2);
    expect(result.body.error.code).toBe('INVALID_ARGUMENT');
    expect(result.body.events).toEqual([]);
  });
  it('uses the same Markdown-only contract when inspecting and rendering templates', async () => {
    await mkdir(join(project, 'bin/templates'), { recursive: true });
    await writeFile(join(project, 'bin/templates/example.txt'), '# {{title}}\n');
    await writeFile(join(project, 'bin/templates/example.MD'), '# {{title}}\n');
    for (const template of ['example.txt', 'missing.txt']) {
      for (const args of [['templates', 'inspect', template], ['make', 'document', 'Example', '--template', template]]) {
        const result = cli(args);
        expect(result.status).toBe(2);
        expect(result.body.error.code).toBe('INVALID_TEMPLATE');
        expect(result.body.events).toEqual([]);
      }
    }
    expect(cli(['templates', 'inspect', 'example.MD']).body.data.variables).toEqual(['title']);
    expect(cli(['make', 'document', 'Example', '--template', 'example.MD', '--dry-run']).status).toBe(0);
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
    await mkdir(join(project, 'bin/plugins/quality'), { recursive: true });
    await writeFile(join(project, 'bin/plugins/quality/manifest.json'), JSON.stringify({ id: 'quality', name: 'Quality', version: '1.0.0', minAppVersion: '0.1.0', description: 'Quality fixture', author: 'Tests' }));
    await writeFile(join(project, 'bin/plugins/quality/main.mjs'), `export default {
      events: [{ id: 'quality.checked', validate: p => typeof p === 'string' }],
      commands: [{ id: 'quality.check', description: 'Check', usage: 'quality.check --label text', options: { label: 'string' }, async run(args, flags, ctx) { await ctx.events.emit('quality.checked', flags.label); return { label: flags.label }; } }],
      generators: [{ id: 'quality.fixture', description: 'Fixture', generate(name, out) { return [{ path: out + '/' + name + '.md', bytes: new TextEncoder().encode('# Fixture') }]; } }],
      skills: [{ id: 'quality.review', content: 'Review a change.' }],
      onload(ctx) { this.context = ctx; ctx.events.on('file.created', () => { throw new Error('Observer failed'); }); },
      onunload() { this.context.events.warn('cleaned up'); }
    };`);
    const pluginConfig = join(project, 'bin/config.json');
    await writeFile(pluginConfig, JSON.stringify({ plugins: { enabled: ['quality'] } }));
    const args: string[] = [];
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
    await rm(pluginConfig);
    expect(cli(['quality.check']).body.error.code).toBe('UNKNOWN_COMMAND');
  });
  it('installs embedded skills from the copied bundle', async () => {
    expect(cli(['skills', 'install']).status).toBe(0);
    expect(await readFile(join(project, '.agents/skills/forge-workflow/SKILL.md'), 'utf8')).toContain('CONFLICT');
    expect(cli(['skills', 'install']).body.error.code).toBe('CONFLICT');
  });

  it('loads fixed workspace configuration and allows invocation overrides', async () => {
    const configuredRoot = join(project, 'configured-workspace');
    await mkdir(join(configuredRoot, 'bin'), { recursive: true });
    const config = join(configuredRoot, 'bin/config.json');
    await writeFile(config, JSON.stringify({ paths: { projects: 'src' }, settings: { dryRun: true, json: true } }));
    const invocation = { root: configuredRoot, cwd: bundle };
    const loaded = cli(['config'], undefined, invocation);
    expect(loaded.status).toBe(0);
    expect(loaded.body.data.root).toBe(configuredRoot);
    expect(loaded.body.data.config.paths.projects).toBe('src');
    expect(loaded.body.data.path).toBe(config);
    const make = ['make', 'entity', 'ConfiguredItem', '--out', 'generated/models'];
    const preview = cli(make, undefined, invocation);
    expect(preview.status).toBe(0); expect(preview.body.data.dryRun).toBe(true); expect(preview.body.events).toEqual([]);
    expect(await readdir(configuredRoot)).toEqual(['bin']);
    expect(cli(['--no-dry-run', ...make], undefined, invocation).status).toBe(0);
    expect(await readFile(join(configuredRoot, 'generated/models/configured-item.ts'), 'utf8')).toContain('class ConfiguredItem');
    expect(cli(['config']).body.data.root).toBe(project);
    for (const invalid of [{ settings: { dryrun: true } }, { paths: { templates: '../outside' } }, { paths: { root: '..' } }, { plugins: { enabled: ['same', 'same'] } }, { unknown: true }]) {
      await writeFile(config, JSON.stringify(invalid));
      expect(cli(['config'], undefined, invocation).body.error.code).toBe('INVALID_CONFIG');
    }
    await rm(config);
    expect(cli(['config'], undefined, invocation).body.data.path).toBeNull();
    expect(cli(['--config', config, 'config']).body.error.code).toBe('UNKNOWN_OPTION');
  });

  it('treats flag-shaped command values as literal data without overriding configured dry runs or routing', async () => {
    const isolated = join(project, 'literal-values-workspace');
    await mkdir(join(isolated, 'bin'), { recursive: true });
    const config = join(isolated, 'bin/config.json');
    await writeFile(config, JSON.stringify({ settings: { dryRun: true } }));
    const args: string[] = [];
    const invocation = { root: isolated };
    for (const literal of ['--no-dry-run', '--root', '--config', '--version', '--no-plugins', '--help', '--json']) {
      const result = cli([...args, 'create', 'preview.md', '--content', literal], undefined, invocation);
      expect(result.status, literal).toBe(0);
      expect(result.body.data.dryRun, literal).toBe(true);
      expect(result.body.data.changes[0]).toMatchObject({ path: 'preview.md', bytes: Buffer.byteLength(literal), revision: createHash('sha256').update(literal).digest('hex') });
      expect(result.body.events, literal).toEqual([]);
      expect(await readdir(isolated)).toEqual(['bin']);
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
    await mkdir(join(project, 'bin/templates'), { recursive: true });
    const template = '---\ntitle: {{title}}\ncreated: {{date}}\ntags: {{tags}}\nsummary: "{{summary}}"\n---\n# {{title}}\n\n[[Architecture]]\n> [!tip]\n> {{summary}}\n';
    await writeFile(join(project, 'bin/templates/entity.md'), template);
    const config = join(project, 'bin/config.json');
    await writeFile(config, JSON.stringify({ templates: { dateFormat: 'YYYY/MM/DD' } }));
    const args: string[] = [];
    expect(cli([...args, 'templates', 'list']).body.data.templates).toContain('entity.md');
    expect(cli([...args, 'templates', 'inspect', 'entity.md']).body.data.variables).toEqual(['date', 'summary', 'tags', 'title']);
    const values = { tags: ['entity', 'domain'], summary: 'Quoted: value\nextra: true' };
    await writeFile(join(project, 'template-values.json'), JSON.stringify(values));
    const make = [...args, 'make', 'document', 'Work Item', '--template', 'entity.md', '--out', 'documents', '--values-from', 'template-values.json', '--date', '2026-10-07T14:05:00Z'];
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
    await rm(config);
  });

  it('creates discoverable library projects and tested components in the configured directory', async () => {
    const config = join(project, 'bin/config.json');
    await writeFile(config, JSON.stringify({ paths: { projects: 'src' } }));
    const args: string[] = [];
    expect(cli([...args, 'project', 'list']).body.data.projects).toEqual([]);
    const preview = cli([...args, 'project', 'create', 'task-lib', '--dry-run']);
    expect(preview.status).toBe(0); expect(preview.body.events).toEqual([]);
    await expect(readFile(join(project, 'src/task-lib/package.json'))).rejects.toThrow();
    expect(cli([...args, 'project', 'create', 'task-lib']).status).toBe(0);
    const manifest = JSON.parse(await readFile(join(project, 'src/task-lib/package.json'), 'utf8'));
    expect(manifest).toMatchObject({
      name: 'task-lib',
      scripts: { 'check:fast': 'npm run check:structure && npm run lint && npm run analyze && npm run typecheck', check: 'npm run check:fast && npm run build && npm test' },
      devDependencies: { fallow: expect.any(String), oxlint: expect.any(String), vite: expect.any(String), vitest: expect.any(String), typescript: expect.any(String) },
    });
    expect(cli([...args, 'project', 'list']).body.data.projects).toEqual([{ schemaVersion: 1, name: 'task-lib', type: 'library', directory: 'src/task-lib' }]);
    expect(cli([...args, 'project', 'inspect', 'task-lib']).body.data.directory).toBe('src/task-lib');
    expect(cli([...args, 'project', 'component', 'task-lib', 'WorkItem', '--dry-run']).body.events).toEqual([]);
    await expect(readFile(join(project, 'src/task-lib/src/domain/work-item.ts'))).rejects.toThrow();
    expect(cli([...args, 'project', 'component', 'task-lib', 'WorkItem']).status).toBe(0);
    expect(await readFile(join(project, 'src/task-lib/tests/work-item.domain.unit.test.ts'), 'utf8')).toContain('rejects an empty identity');
    expect(cli([...args, 'project', 'component', 'task-lib', 'FindItem', '--kind', 'application']).status).toBe(0);
    expect(await readFile(join(project, 'src/task-lib/src/application/find-item.ts'), 'utf8')).toContain('FindItemRepository');
    expect(cli([...args, 'project', 'component', 'task-lib', 'WorkItem']).body.error.code).toBe('CONFLICT');
    expect(cli([...args, 'project', 'create', 'task-lib']).body.error.code).toBe('PROJECT_EXISTS');
    expect(cli([...args, 'project', 'inspect', 'absent']).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect(cli([...args, 'project', 'create', '../escape']).body.error.code).toBe('INVALID_PROJECT_NAME');
    expect(cli([...args, 'project', 'component', 'task-lib', 'Other', '--kind', 'infrastructure']).body.error.code).toBe('INVALID_ARGUMENT');
    await rm(config);
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
    expect(JSON.parse(await readFile(join(installation, 'bin/config.json'), 'utf8')).paths).toEqual({ projects: 'projects' });
    expect(await readFile(join(installation, '.agents/skills/forge-workflow/SKILL.md'), 'utf8')).toContain('CONFLICT');
    expect(await readFile(join(installation, 'bin/templates/entity.md'), 'utf8')).toContain('{{title}}');
    const repeated = cli(['setup'], undefined, invocation);
    expect(repeated.status).toBe(0); expect(repeated.body.data.changes).toEqual([]); expect(repeated.body.events).toEqual([]);
    const installed = { entry: join(installation, 'bin/app.js'), root: null, cwd: bundle };
    const config = cli(['config'], undefined, installed);
    expect(config.status).toBe(0); expect(config.body.data.root).toBe(installation);
    expect(cli(['make', 'document', 'Installed Entity', '--template', 'entity.md', '--date', '2026-10-07'], undefined, installed).status).toBe(0);
    expect(await readFile(join(installation, 'notes/Installed Entity.md'), 'utf8')).toContain('# Installed Entity');
  });

});
