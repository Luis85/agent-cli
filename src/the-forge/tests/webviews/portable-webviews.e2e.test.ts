import { expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { committedEvents } from '../support/events.ts';

const fixture = portableCli();

/** Small static outputs exercise publication and mounting without installing a second frontend toolchain. */
async function buildFixture(name: string, title: string) {
  const root = join(fixture.project, 'projects', name, 'dist');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ id: name, name, entry: 'index.html' }));
  await writeFile(join(root, 'index.html'), `<h1>${title}</h1><script src="./app.js"></script>`);
  await writeFile(join(root, 'app.js'), `document.title = ${JSON.stringify(title)};`);
}

it('publishes two independent views, refreshes an existing mount, and mounts new views after restart', async () => {
  const setup = await fixture.cli(['setup']);
  expect(setup.status, setup.stdout).toBe(0);
  const invoke = (args: string[]) => fixture.cli(args, undefined, { entry: join(fixture.project, 'bin/forge.js') });
  const cli = async (args: string[]) => {
    const response = await invoke(args);
    expect(response.status, response.stdout).toBe(0);
    return response.body;
  };
  for (const name of ['first-view', 'second-view']) {
    await cli(['project', 'create', name, '--type', 'webview']);
    await buildFixture(name, name);
  }
  await cli(['project', 'open', 'first-view']);
  const selected = await readFile(join(fixture.project, 'bin/data/context.json'), 'utf8');
  const before = await cli(['webview', 'inspect']);
  expect(before.data.revision).toBeNull();
  const preview = await cli(['webview', 'publish', '--dry-run']);
  expect(committedEvents(preview.events)).toEqual([]);
  await expect(readFile(join(fixture.project, 'bin/webviews/first-view/index.html'))).rejects.toThrow();
  await cli(['webview', 'publish']);
  await cli(['webview', 'publish', '--check']);
  const firstInspect = await cli(['webview', 'inspect']);
  expect(firstInspect.data.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await readFile(join(fixture.project, 'bin/data/context.json'), 'utf8')).toBe(selected);
  try {
    const started = await cli(['server', 'start', '--webview', 'first-view']);
    const firstUrl = new URL(started.data.url);
    expect(firstUrl.pathname).toBe('/views/first-view/');
    expect(await (await fetch(firstUrl)).text()).toContain('<h1>first-view</h1>');
    await buildFixture('first-view', 'Updated prototype');
    const drift = await invoke(['webview', 'publish', '--check']);
    expect([drift.status, drift.body.error.code]).toEqual([5, 'WEBVIEW_DRIFT']);
    expect((await invoke(['webview', 'publish'])).body.error.code).toBe('CONFLICT');
    await cli(['webview', 'publish', '--if-match', firstInspect.data.revision]);
    expect(await (await fetch(firstUrl)).text()).toContain('<h1>Updated prototype</h1>');
    expect((await cli(['server', 'status'])).data.server.pid).toBe(started.data.server.pid);
    await cli(['project', 'open', 'second-view']);
    await cli(['webview', 'publish']);
    const running = await cli(['server', 'status']);
    expect(running.data.webviews.map((view: { id: string }) => view.id)).not.toContain('second-view');
    expect((await fetch(new URL('/views/second-view/', firstUrl))).status).toBe(404);
    await cli(['server', 'stop']);
    const offline = await cli(['server', 'status']);
    expect(offline.data.webviews.map((view: { id: string }) => view.id)).toEqual(expect.arrayContaining(['admin', 'first-view', 'second-view']));
    const restarted = await cli(['server', 'start', '--webview', 'second-view']);
    const secondUrl = new URL(restarted.data.url);
    expect(await (await fetch(secondUrl)).text()).toContain('<h1>second-view</h1>');
    expect(await (await fetch(new URL('/views/first-view/', secondUrl))).text()).toContain('<h1>Updated prototype</h1>');
    expect((await cli(['project', 'current'])).data.project.name).toBe('second-view');
    const distribution = JSON.parse(await readFile(join(fixture.project, 'bin/data/distribution.json'), 'utf8'));
    expect(distribution.files.some((path: string) => /webviews\/(first-view|second-view)\//.test(path))).toBe(false);
  } finally {
    const stopped = await invoke(['server', 'stop']);
    expect(stopped.status, stopped.stdout).toBe(0);
    expect(stopped.body.data.running).toBe(false);
  }
}, 60_000);
