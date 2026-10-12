import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { committedEvents } from '../support/events.ts';

const enabled = process.env.FORGE_BROWSER_TESTS === '1';

/** Linux browser CI opts in after installing Chromium; other core matrix jobs explicitly skip this runtime suite. */
describe.skipIf(!enabled)('portable browser captures and illustrated tutorials', () => {
  const fixture = portableCli();
  const received: string[] = [];
  let url: string;
  let pageRequests = 0;
  const server = createServer((request, response) => {
    const route = new URL(request.url ?? '/', 'http://localhost');
    if (route.pathname === '/saved') {
      received.push(route.searchParams.get('note') ?? '');
      response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('Saved'); return;
    }
    pageRequests++;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="en"><head><title>Capture acceptance</title><link rel="icon" href="data:,"></head>
      <body><main><h1>Write a note</h1><label for="note">Note</label><input id="note"><button id="save">Save note</button>
      <p role="status" hidden></p></main><script>document.querySelector('#save').onclick = async () => {
        const value = document.querySelector('#note').value;
        await fetch('/saved?note=' + encodeURIComponent(value));
        const status = document.querySelector('[role=status]'); status.textContent = 'Saved ' + value; status.hidden = false;
      };</script></body></html>`);
  });
  const invoke = (args: string[]) => fixture.cli(args);
  const cli = async (args: string[]) => {
    const result = await invoke(args);
    expect(result.status, result.stdout).toBe(0);
    return result.body;
  };

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address');
    url = `http://127.0.0.1:${address.port}/`;
    const status = await cli(['browser', 'status']);
    // An enabled suite must fail when runtime setup is missing; it must never silently skip.
    expect(status.data.available, JSON.stringify(status.data)).toBe(true);
    await cli(['setup']);
    await cli(['project', 'create', 'browser-proof']);
    await cli(['project', 'open', 'browser-proof']);
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it('captures guarded PNGs at desktop and mobile dimensions without browser activity in previews', async () => {
    const before = pageRequests;
    const args = ['browser', 'screenshot', `${url}#private-fragment`, '--out', 'docs/desktop.png', '--width', '1200', '--height', '800', '--wait-for-selector', 'h1'];
    const preview = await cli([...args, '--dry-run']);
    expect(preview.data).toMatchObject({ dryRun: true, captured: false, plan: { requestedUrl: url } });
    expect(committedEvents(preview.events)).toEqual([]);
    expect(pageRequests).toBe(before);
    const desktop = await cli(args);
    expect(desktop.data).toMatchObject({ captured: true, width: 1200, height: 800, path: 'docs/desktop.png', requestedUrl: url, finalUrl: url });
    expect(desktop.data.markdown).toContain('docs/desktop.png');
    const path = join(fixture.project, 'projects/browser-proof/docs/desktop.png');
    const png = await readFile(path);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 800]);
    const capturedRequests = pageRequests;
    expect((await invoke(args)).body.error.code).toBe('CONFLICT');
    expect(pageRequests).toBe(capturedRequests);
    expect(await readFile(path)).toEqual(png);
    const mobileArgs = args.map(value => value === '1200' ? '390' : value === '800' ? '844' : value);
    const mobile = await cli([...mobileArgs, '--if-match', desktop.data.revision]);
    expect(mobile.data).toMatchObject({ width: 390, height: 844 });
    expect((await invoke([...args, '--if-match', desktop.data.revision])).body.error.code).toBe('CONFLICT');
  }, 60_000);

  it('replays interactions and writes a complete tutorial with relative images and guarded reruns', async () => {
    const plan = { version: 1, title: 'Save a note', startUrl: url, viewport: { width: 960, height: 720 }, steps: [
      { id: 'open', title: 'Open the editor', text: 'Start with an empty note.', actions: [] },
      { id: 'saved', title: 'Save the note', text: 'Enter the text and save it.', actions: [
        { type: 'fill', locator: { label: 'Note' }, value: 'A repeatable workflow' },
        { type: 'click', locator: { role: 'button', name: 'Save note' } },
        { type: 'wait', locator: { role: 'status' }, state: 'visible' },
      ] },
    ] };
    await cli(['create', 'docs/flow.md', '--content', '# Reviewed workflow\n\n```forge-tutorial\n' + JSON.stringify(plan) + '\n```\n']);
    const args = ['browser', 'tutorial', 'docs/flow.md', '--out', 'docs/tutorial'];
    const requests = pageRequests;
    const validated = await cli(['browser', 'validate', 'docs/flow.md', '--out', 'docs/tutorial']);
    expect(validated.data.revision).toBeNull();
    const preview = await cli([...args, '--dry-run']);
    expect(preview.data).toMatchObject({ dryRun: true, executed: false });
    expect(committedEvents(preview.events)).toEqual([]);
    expect(pageRequests).toBe(requests);
    const result = await cli(args);
    expect(result.data).toMatchObject({ executed: true, dryRun: false, output: 'docs/tutorial' });
    expect(received).toEqual(['A repeatable workflow']);
    const output = join(fixture.project, 'projects/browser-proof/docs/tutorial');
    const manual = await readFile(join(output, 'index.md'), 'utf8');
    expect(manual).toContain('# Save a note');
    const images = [...manual.matchAll(/!\[[^\]]*\]\(<([^>]+)>\)/g)].map(match => match[1]);
    expect(images).toEqual(['screenshots/open.png', 'screenshots/saved.png']);
    expect(manual).not.toContain(fixture.project);
    expect(JSON.parse(await readFile(join(output, 'flow.json'), 'utf8')).steps).toHaveLength(2);
    expect((await readdir(join(output, 'screenshots'))).sort()).toEqual(['open.png', 'saved.png']);
    const first = await readFile(join(output, 'screenshots/open.png'));
    const last = await readFile(join(output, 'screenshots/saved.png'));
    expect(last).not.toEqual(first);
    const repeated = await invoke(args);
    expect(repeated.body.error.code).toBe('CONFLICT');
    expect(received).toHaveLength(1);
    expect(await readFile(join(output, 'index.md'), 'utf8')).toBe(manual);
    const inspected = await cli(['browser', 'validate', 'docs/flow.md', '--out', 'docs/tutorial']);
    expect(inspected.data.revision).toBe(result.data.revision);
    await cli([...args, '--if-match', inspected.data.revision]);
    expect(received).toEqual(['A repeatable workflow', 'A repeatable workflow']);
    expect((await invoke([...args, '--if-match', inspected.data.revision])).body.error.code).toBe('CONFLICT');
  }, 60_000);
});
