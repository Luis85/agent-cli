import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSnapshotProvider } from '../../src/infrastructure/server/snapshot.ts';
import type { ServerInfo } from '../../src/application/server/contracts.ts';

const info: ServerInfo = { pid: 12, port: 3456, host: '127.0.0.1', startedAt: '2026-01-01T00:00:00.000Z', version: '0.1.0', nodeVersion: 'v24.0.0', uptimeSeconds: 10 };

describe('read-only system snapshot', () => {
  let root: string;
  beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'forge-snapshot-'))); });
  afterEach(async () => { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

  it('executes fixed discovery commands, whitelists state, and coalesces concurrent refreshes', async () => {
    await writeFile(join(root, 'forge.js'), `
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
      const project = { schemaVersion: 1, name: 'Demo', type: 'library', directory: 'src/demo' };
      let data;
      if (args.includes('config')) data = { config: { paths: { projects: 'src' }, plugins: { settings: { secret: 'never-publish-me' } } } };
      else if (args.includes('list')) data = { projects: [project] };
      else if (args.includes('current')) data = { project };
      else if (args.includes('plugins')) data = { plugins: [{ id: 'example', name: 'Example', version: '1', state: 'enabled', core: true, description: 'Demo', reason: 'never-publish-me', contributions: { commands: ['example'], generators: ['sample'], skills: ['agent'] } }] };
      else data = { commands: [{ id: 'help' }, { id: 'example' }], generators: [{ id: 'sample' }], skills: ['agent', 'kernel-skill'] };
      process.stdout.write(JSON.stringify({ ok: true, data }));
    `);
    const snapshot = createSnapshotProvider({ workspaceRoot: root, distributionPath: root, server: () => info, webviews: [] });
    const [first, second] = await Promise.all([snapshot(), snapshot()]);
    expect(first).toEqual(second);
    expect(first.workspace).toEqual({ root, projectsPath: 'src', selectedProject: { schemaVersion: 1, name: 'Demo', type: 'library', directory: 'src/demo' } });
    expect(first.stats).toEqual({ projects: 1, plugins: 1, enabledPlugins: 1, commands: 2, generators: 1, skills: 2 });
    expect(JSON.stringify(first)).not.toContain('never-publish-me');
    expect(first.warnings).toEqual([]);
    expect(first.availability).toEqual({ config: true, projects: true, selectedProject: true, plugins: true, capabilities: true });
    await snapshot();
    const calls = (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map((line: string) => JSON.parse(line) as string[]);
    expect(calls).toHaveLength(5);
    for (const args of calls) expect(args.slice(0, 7)).toEqual(['--root', root, '--json', '--events', 'none', '--dry-run', expect.any(String)]);
  });

  it('aborts in-flight inspection subprocesses during shutdown', async () => {
    await writeFile(join(root, 'forge.js'), `setTimeout(() => {}, 60000);`);
    const cancellation = new AbortController();
    const snapshot = createSnapshotProvider({ workspaceRoot: root, distributionPath: root, server: () => info, webviews: [], signal: cancellation.signal });
    const collecting = snapshot();
    cancellation.abort();
    expect((await collecting).warnings).toHaveLength(5);
  });

  it('reports partial failures without exposing raw command errors or credentials', async () => {
    await writeFile(join(root, 'forge.js'), `process.stderr.write('sensitive-plugin-error'); process.exit(1);`);
    const snapshot = createSnapshotProvider({ workspaceRoot: root, distributionPath: root, server: () => info, webviews: [] });
    const result = await snapshot();
    expect(result.projects).toEqual([]);
    expect(result.availability).toEqual({ config: false, projects: false, selectedProject: false, plugins: false, capabilities: false });
    expect(result.warnings).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain('sensitive-plugin-error');
    expect(result.workspace.selectedProject).toBeNull();
  });

  it('marks malformed discovery results unavailable rather than reporting healthy empty state', async () => {
    await writeFile(join(root, 'forge.js'), `process.stdout.write(JSON.stringify({ ok: true, data: {} }));`);
    const snapshot = createSnapshotProvider({ workspaceRoot: root, distributionPath: root, server: () => info, webviews: [] });
    const result = await snapshot();
    expect(result.availability).toEqual({ config: false, projects: false, selectedProject: false, plugins: false, capabilities: false });
    expect(result.warnings).toHaveLength(5);
  });

  it('preserves successful results while surfacing sanitized CLI warnings', async () => {
    await writeFile(join(root, 'forge.js'), `
      const args = process.argv.slice(2);
      const data = args.includes('config') ? { config: { paths: { projects: 'src' } } }
        : args.includes('list') ? { projects: [] } : args.includes('current') ? { project: null }
        : args.includes('plugins') ? { plugins: [] } : { commands: [], generators: [], skills: [] };
      process.stdout.write(JSON.stringify({ ok: true, data, warnings: ['private-plugin-token'] }));
    `);
    const snapshot = createSnapshotProvider({ workspaceRoot: root, distributionPath: root, server: () => info, webviews: [] });
    const result = await snapshot();
    expect(result.availability).toEqual({ config: true, projects: true, selectedProject: true, plugins: true, capabilities: true });
    expect(result.warnings).toHaveLength(5);
    expect(result.warnings[0]).toContain('config inspection reported warnings');
    expect(JSON.stringify(result)).not.toContain('private-plugin-token');
  });
});
