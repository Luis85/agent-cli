import { beforeAll, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
let project: string;
beforeAll(() => { project = fixture.project; });

it('loads runtime plugins, generators, skills and event subscriptions from a portable bundle', async () => {
    await mkdir(join(project, 'bin/plugins/quality'), { recursive: true });
    await writeFile(join(project, 'bin/plugins/quality/manifest.json'), JSON.stringify({ id: 'quality', name: 'Quality', version: '1.0.0', minAppVersion: '0.1.0', description: 'Quality fixture', author: 'Tests' }));
    await writeFile(join(project, 'bin/plugins/quality/main.mjs'), `export default {
      events: [{ id: 'quality.checked', validate: p => typeof p === 'string' }],
      commands: [{ id: 'quality.check', description: 'Check', usage: 'quality.check --label text', mutating: false, options: { label: { type: 'string', description: 'Label to echo' } }, async run(args, flags, ctx) { await ctx.events.emit('quality.checked', flags.label); return { label: flags.label }; } }],
      generators: [{ id: 'quality.fixture', description: 'Fixture', generate({ name, directory }) { return [{ path: directory + '/' + name + '.md', bytes: new TextEncoder().encode('# Fixture') }]; } }],
      skills: [{ id: 'quality.review', content: 'Review a change.' }],
      onload(ctx) { this.context = ctx; ctx.events.on('vault.create', () => { throw new Error('Observer failed'); }); },
      onunload() { this.context.events.warn('cleaned up'); }
    };`);
    const pluginConfig = join(project, 'bin/config.json');
    await writeFile(pluginConfig, JSON.stringify({ plugins: { enabled: ['quality'] } }));
    const args: string[] = [];
    const check = cli([...args, 'quality.check', '--label', 'ready', '--events', 'all']);
    expect(check.status).toBe(0); expect(check.body.data.label).toBe('ready');
    expect(check.body.events.filter((event: { id: string }) => event.id === 'quality.checked')).toEqual([{ id: 'quality.checked', payload: 'ready' }]);
    expect(check.body.warnings).toContain('cleaned up');
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
