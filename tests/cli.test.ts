import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
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
function cli(args: string[], input?: string | Buffer) {
  const result = spawnSync(process.execPath, [join(bundle, 'app'), '--root', project, '--json', ...args], { encoding: 'utf8', input, timeout: 10000, env: { ...process.env, NODE_PATH: '' } });
  expect(result.error).toBeUndefined(); expect(result.stderr).toBe('');
  return { status: result.status, body: JSON.parse(result.stdout) };
}
describe('portable CLI without installed dependencies', () => {
  it('discovers commands, help and global options from any working directory', () => {
    const { status, body } = cli(['schema']);
    expect(status).toBe(0); expect(body.ok).toBe(true); expect(body.data.commands.map((c: { id: string }) => c.id)).toContain('make');
    expect(cli(['make', '--help']).body.data.usage).toContain('generator');
    expect(cli(['--version']).body.data.version).toBe('0.1.0');
  });
  it('rejects unknown commands/options and missing values with machine-readable errors', () => {
    for (const args of [['nonsense'], ['read', 'a.md', '--typo'], ['write', 'a.md', '--content'], ['read'], ['read', 'a.md', '--json']]) {
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
    await mkdir(join(project, 'plugins'), { recursive: true });
    await writeFile(join(project, 'plugins/quality.mjs'), `export default {
      manifest: { id: 'quality', version: '1.0.0', apiVersion: 1 },
      events: [{ id: 'quality.checked', validate: p => typeof p === 'string' }],
      commands: [{ id: 'quality.check', description: 'Check', usage: 'quality.check --label text', options: { label: 'string' }, async run(args, flags, ctx) { await ctx.events.emit('quality.checked', flags.label); return { label: flags.label }; } }],
      generators: [{ id: 'quality.fixture', description: 'Fixture', generate(name, out) { return [{ path: out + '/' + name + '.md', bytes: new TextEncoder().encode('# Fixture') }]; } }],
      skills: [{ id: 'quality.review', content: 'Review a change.' }],
      activate(ctx) { ctx.events.on('file.created', () => { throw new Error('Observer failed'); }); return () => { ctx.events.warn('cleaned up'); }; }
    };`);
    await writeFile(join(project, 'plugins.json'), '{"apiVersion":1,"plugins":["plugins/quality.mjs"]}');
    const args = ['--plugins', 'plugins.json'];
    const check = cli([...args, 'quality.check', '--label', 'ready']);
    expect(check.status).toBe(0); expect(check.body.data.label).toBe('ready'); expect(check.body.events[0].id).toBe('quality.checked'); expect(check.body.warnings).toContain('cleaned up');
    const generated = cli([...args, 'make', 'quality.fixture', 'Example', '--out', 'fixtures']);
    expect(generated.status).toBe(0); expect(generated.body.warnings.some((w: string) => w.includes('Observer failed'))).toBe(true);
    expect(await readFile(join(project, 'fixtures/Example.md'), 'utf8')).toBe('# Fixture');
    expect(cli([...args, 'skills', 'show', 'quality.review']).body.data.content).toBe('Review a change.');
    expect(cli(['quality.check']).body.error.code).toBe('UNKNOWN_COMMAND');
  });
  it('installs embedded skills from the copied bundle', async () => {
    expect(cli(['skills', 'install']).status).toBe(0);
    expect(await readFile(join(project, '.agents/skills/agent-cli-workflow/SKILL.md'), 'utf8')).toContain('CONFLICT');
    expect(cli(['skills', 'install']).body.error.code).toBe('CONFLICT');
  });
});
