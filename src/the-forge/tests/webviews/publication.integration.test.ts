import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { WebviewPublication } from '../../src/plugins/webviews/application/publish.ts';
import { readWebviewAssets } from '../../src/plugins/webviews/infrastructure/assets.ts';
import { ScopedFiles } from '../../src/application/workspace/scoped-files.ts';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { vaultScope, writeVault } from '../support/vault.ts';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const publication = new WebviewPublication(readWebviewAssets);
const manifest = JSON.stringify({ id: 'prototype', name: 'Prototype', entry: 'index.html' });
async function fixture(dryRun = false) {
  const root = await mkdtemp(join(tmpdir(), 'forge-webview-')); temporary.push(root);
  const projectRoot = join(root, 'src/prototype');
  await mkdir(projectRoot, { recursive: true });
  await writeVault(root, { 'bin/data/distribution.json': '{"owned":"unchanged"}', 'bin/config.json': '{}', 'bin/data/context.json': '{"name":"prototype"}' });
  const scope = await vaultScope(root, { dryRun });
  const context: CommandContext = {
    workspace: scope.workspace.within(new ScopedFiles(scope.files, 'src/prototype'), projectRoot), environment: scope.workspace,
    events: scope.events, metadata: scope.metadata, app: scope.app, workspaceRoot: root, root: projectRoot,
    project: { schemaVersion: 1, name: 'prototype', type: 'webview', directory: 'src/prototype' }, language: 'en', input: async () => new Uint8Array(),
  };
  const build = (files: Record<string, string> = {}) => writeVault(projectRoot, { 'dist/index.html': '<h1>Prototype</h1>', 'dist/manifest.json': manifest, ...files });
  return { root, projectRoot, context, scope, build, output: join(root, 'bin/webviews/prototype') };
}

describe('webview publication', () => {
  it('inspects an unbuilt project without creating assets and explains the required build', async () => {
    const { context, root } = await fixture();
    expect(await publication.inspect(context)).toEqual({ id: 'prototype', source: 'dist', destination: 'bin/webviews/prototype', built: false, installed: false, revision: null, current: false, files: [] });
    await expect(publication.publish(context, {})).rejects.toMatchObject({ code: 'WEBVIEW_BUILD_REQUIRED' });
    await expect(readdir(join(root, 'bin/webviews'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('publishes built notices and binary assets without modifying distribution ownership or selection', async () => {
    const { context, root, projectRoot, build, output } = await fixture();
    await build({ 'dist/licenses/node_modules__vue__LICENSE': 'MIT', 'dist/licenses/node_modules__lucide__LICENSE.md': 'ISC', 'dist/THIRD-PARTY-NOTICES.md': '# Notices' });
    await writeFile(join(projectRoot, 'dist/image.png'), new Uint8Array([0, 255, 50, 128]));
    const result = await publication.publish(context, {});
    expect(result).toMatchObject({ changed: true, installed: true, current: true, dryRun: false, revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(await readFile(join(output, 'image.png'))).toEqual(Buffer.from([0, 255, 50, 128]));
    expect(await readFile(join(output, 'licenses/node_modules__vue__LICENSE'), 'utf8')).toBe('MIT');
    expect(await readFile(join(root, 'bin/data/distribution.json'), 'utf8')).toBe('{"owned":"unchanged"}');
    expect(await readFile(join(root, 'bin/data/context.json'), 'utf8')).toBe('{"name":"prototype"}');
    expect(await publication.publish(context, {})).toMatchObject({ changed: false, changes: [], revision: result.revision });
    expect(await publication.publish(context, { check: true })).toMatchObject({ checked: true, changed: false, current: true });
  });

  it('requires an inspected folder revision to replace files and removes obsolete chunks', async () => {
    const { context, projectRoot, build, output } = await fixture();
    await build({ 'dist/assets/old.js': 'old' });
    const first = await publication.publish(context, {});
    await rm(join(projectRoot, 'dist/assets/old.js'));
    await build({ 'dist/index.html': '<h1>Updated</h1>', 'dist/assets/new.js': 'new' });
    await expect(publication.publish(context, {})).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(publication.publish(context, { ifMatch: '0'.repeat(64) })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(publication.publish(context, { check: true })).rejects.toMatchObject({ code: 'WEBVIEW_DRIFT', exitCode: 5, details: { revision: first.revision } });
    const plan = await publication.inspect(context);
    expect(plan.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'assets/old.js', status: 'obsolete' }), expect.objectContaining({ path: 'assets/new.js', status: 'missing' })]));
    const result = await publication.publish(context, { ifMatch: plan.revision! });
    expect(result).toMatchObject({ current: true, changed: true });
    expect(result.revision).not.toBe(first.revision);
    await expect(readFile(join(output, 'assets/old.js'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(output, 'assets/new.js'), 'utf8')).toBe('new');
    await expect(publication.publish(context, { ifMatch: first.revision! })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('previews publication without creating a destination or emitting committed changes', async () => {
    const { context, scope, build, output } = await fixture(true);
    await build();
    const result = await publication.publish(context, {});
    expect(result).toMatchObject({ dryRun: true, installed: false, revision: null, changed: true });
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(scope.records()).toEqual([]);
  });

  it('treats an existing empty destination as user-owned and requires its revision', async () => {
    const { context, build, output } = await fixture();
    await build(); await mkdir(output, { recursive: true });
    await expect(publication.publish(context, {})).rejects.toMatchObject({ code: 'CONFLICT' });
    const inspected = await publication.inspect(context);
    expect(inspected.installed).toBe(true);
    expect(await publication.publish(context, { ifMatch: inspected.revision! })).toMatchObject({ current: true });
  });

  it.each(['destination', 'source'])('guards the complete %s folder against changes after planning', async changed => {
    const { context, scope, projectRoot, build, output } = await fixture();
    await build();
    const installed = await publication.publish(context, {});
    await build({ 'dist/index.html': '<h1>Changed</h1>' });
    scope.events.on('operation.started', async () => {
      await writeFile(join(changed === 'destination' ? output : join(projectRoot, 'dist'), 'concurrent.js'), 'concurrent');
    });
    await expect(publication.publish(context, { ifMatch: installed.revision! })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(join(output, 'index.html'), 'utf8')).toBe('<h1>Prototype</h1>');
  });

  it.each(['wrong-id', 'wrong-entry', 'empty-name', 'invalid-json'])('rejects a malformed build manifest: %s', async invalid => {
    const { context, build } = await fixture();
    const value = invalid === 'invalid-json' ? '{' : JSON.stringify({ id: invalid === 'wrong-id' ? 'other' : 'prototype', name: invalid === 'empty-name' ? ' ' : 'Prototype', entry: invalid === 'wrong-entry' ? 'other.html' : 'index.html' });
    await build({ 'dist/manifest.json': value });
    await expect(publication.publish(context, {})).rejects.toMatchObject({ code: 'WEBVIEW_INVALID' });
  });

  it.each(['build', 'installed'])('rejects linked %s assets without changing their target', async location => {
    const { context, root, projectRoot, build, output } = await fixture();
    await build();
    if (location === 'installed') await publication.publish(context, {});
    await writeFile(join(root, 'private.js'), 'private');
    await symlink(join(root, 'private.js'), join(location === 'build' ? join(projectRoot, 'dist') : output, 'linked.js'));
    await expect(publication.inspect(context)).rejects.toMatchObject({ code: 'WEBVIEW_INVALID' });
    expect(await readFile(join(root, 'private.js'), 'utf8')).toBe('private');
  });

  it('rejects a missing HTML entry before creating installed assets', async () => {
    const { context, projectRoot, build, output } = await fixture(); await build();
    await rm(join(projectRoot, 'dist/index.html'));
    await expect(publication.publish(context, {})).rejects.toMatchObject({ code: 'WEBVIEW_INVALID' });
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO asset without waiting for a writer', async () => {
    const { context, projectRoot, build } = await fixture(); await build();
    execFileSync('mkfifo', [join(projectRoot, 'dist/blocked.js')]);
    await expect(publication.inspect(context)).rejects.toMatchObject({ code: 'WEBVIEW_INVALID' });
  });

  it('explains unsupported file/directory shape changes without touching the installed view', async () => {
    const { context, projectRoot, build, output } = await fixture();
    await build({ 'dist/assets.js': 'old' });
    const first = await publication.publish(context, {});
    await rm(join(projectRoot, 'dist/assets.js'));
    await build({ 'dist/assets.js/new.js': 'new' });
    await expect(publication.publish(context, { ifMatch: first.revision! })).rejects.toMatchObject({ code: 'WEBVIEW_INVALID', message: expect.stringContaining('file/directory boundary') });
    expect(await readFile(join(output, 'assets.js'), 'utf8')).toBe('old');
  });

  it.each(['dist/.env', 'dist/source.ts', 'dist/licenses/.secret'])('rejects development-only build assets: %s', async path => {
    const { context, build } = await fixture(); await build({ [path]: 'private' });
    await expect(publication.publish(context, {})).rejects.toMatchObject({ code: 'WEBVIEW_INVALID' });
  });

  it('requires a webview project and protects the maintained admin view', async () => {
    const { context } = await fixture();
    await expect(publication.inspect({ ...context, project: null })).rejects.toMatchObject({ code: 'PROJECT_REQUIRED' });
    await expect(publication.inspect({ ...context, project: { ...context.project!, type: 'library' } })).rejects.toMatchObject({
      code: 'WEBVIEW_PROJECT_REQUIRED', exitCode: 2, message: expect.stringContaining('has type library'), details: { project: context.project!.name, type: 'library' },
    });
    await expect(publication.inspect({ ...context, project: { ...context.project!, name: 'admin' } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
