import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import type { BrowserRuntime, BrowserFlowRequest } from '../../src/plugins/browser/application/runtime.ts';
import { BrowserTutorial } from '../../src/plugins/browser/application/tutorial.ts';

let root: string, files: NodeFiles, events: EventBus;
const plan = { version: 1, title: 'Start [here]', startUrl: 'https://example.org/', steps: [
  { id: 'open', title: 'Open [page]', text: 'Choose **New** to begin.', actions: [] },
] };
const capture = { stepId: 'open', bytes: new Uint8Array([137, 80, 78, 71]), width: 1440, height: 900,
  url: 'https://example.org/page?token=hidden#token=secret', title: 'A page', capturedAt: '2026-10-11T12:00:00.000Z' };
let flow: ReturnType<typeof vi.fn<BrowserRuntime['flow']>>, tutorial: BrowserTutorial;
async function put(path: string, content: string) {
  await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), content);
}
function context(dryRun = false): CommandContext {
  const workspace = new Workspace(files, new ObsidianDocuments(), events, dryRun, root);
  return { workspace, environment: workspace, root, workspaceRoot: root, project: null, events } as unknown as CommandContext;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-tutorial-')); files = await NodeFiles.at(root);
  events = new EventBus(new NodeEventScope()); registerHostEvents(events);
  flow = vi.fn(async (_request: BrowserFlowRequest) => ({ screenshots: [capture], browserVersion: 'test-browser' }));
  tutorial = new BrowserTutorial({ flow } as unknown as BrowserRuntime);
  await put('intent.json', JSON.stringify(plan));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('tutorial publication', () => {
  it('validates and dry-runs without browser work or output changes', async () => {
    const preview = await tutorial.validate(context(), 'intent.json', 'docs/manual');
    expect(preview).toMatchObject({ revision: null, files: ['index.md', 'flow.json', 'screenshots/open.png'] });
    expect(await tutorial.run(context(true), { source: 'intent.json', out: 'docs/manual' })).toMatchObject({ dryRun: true, executed: false, changes: [] });
    expect(flow).not.toHaveBeenCalled(); expect(await files.list()).toEqual(['intent.json']);
    expect(events.history.filter(event => event.id.startsWith('vault.'))).toEqual([]);
  });
  it('publishes Markdown, relative screenshots and a replayable plan as one batch', async () => {
    const commit = vi.spyOn(files, 'commit');
    const result = await tutorial.run(context(), { source: 'intent.json', out: 'docs/manual' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ executed: true, dryRun: false, browserVersion: 'test-browser' });
    expect(result.changes).toHaveLength(3);
    const manual = await readFile(join(root, 'docs/manual/index.md'), 'utf8');
    expect(manual).toContain('## 1. Open [page]');
    expect(manual).toContain('![Open \\[page\\]](<screenshots/open.png>)');
    expect(manual).toContain('https://example.org/page');
    expect(manual).not.toContain('hidden'); expect(manual).not.toContain('secret');
    expect(JSON.parse(await readFile(join(root, 'docs/manual/flow.json'), 'utf8'))).toMatchObject(plan);
    expect(events.history.filter(event => event.id === 'vault.create')).toHaveLength(6);
  });
  it('requires the reviewed folder revision and allows replaying generated flow.json', async () => {
    const first = await tutorial.run(context(), { source: 'intent.json', out: 'docs/manual' });
    flow.mockClear();
    await expect(tutorial.run(context(), { source: 'intent.json', out: 'docs/manual' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(flow).not.toHaveBeenCalled();
    const next = await tutorial.run(context(), { source: 'docs/manual/flow.json', out: 'docs/manual', ifMatch: first.revision! });
    expect(next.executed).toBe(true);
  });
  it('leaves existing output intact when browser playback fails', async () => {
    const first = await tutorial.run(context(), { source: 'intent.json', out: 'docs/manual' });
    flow.mockRejectedValue(new Error('capture failed'));
    await expect(tutorial.run(context(), { source: 'intent.json', out: 'docs/manual', ifMatch: first.revision! })).rejects.toThrow('capture failed');
    expect((await files.stat('docs/manual')).revision).toBe(first.revision);
  });
  it.each(['source', 'output'])('rejects concurrent %s edits after browser execution without partial output', async which => {
    const first = await tutorial.run(context(), { source: 'intent.json', out: 'docs/manual' });
    flow.mockImplementation(async () => {
      await put(which === 'source' ? 'intent.json' : 'docs/manual/index.md', which === 'source' ? JSON.stringify({ ...plan, title: 'Changed' }) : 'User edit');
      return { screenshots: [{ ...capture, bytes: new Uint8Array([1, 2]) }], browserVersion: 'test-browser' };
    });
    await expect(tutorial.run(context(), { source: 'intent.json', out: 'docs/manual', ifMatch: first.revision! })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(join(root, 'docs/manual/screenshots/open.png'))).toEqual(Buffer.from(capture.bytes));
  });
  it('refuses unrelated output files before browser execution even with a current revision', async () => {
    await tutorial.run(context(), { source: 'intent.json', out: 'docs/manual' });
    await put('docs/manual/notes.md', 'Keep me'); flow.mockClear();
    await expect(tutorial.run(context(), { source: 'intent.json', out: 'docs/manual', ifMatch: (await files.stat('docs/manual')).revision })).rejects.toMatchObject({ code: 'BROWSER_FLOW_INVALID' });
    expect(flow).not.toHaveBeenCalled();
  });
  it('refuses a linked screenshot parent before browser execution or dry-run approval', async () => {
    await put('docs/manual/index.md', 'Manual'); await put('docs/manual/flow.json', JSON.stringify(plan));
    await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), join(root, 'docs/manual/screenshots'), 'junction');
    await expect(tutorial.validate(context(), 'intent.json', 'docs/manual')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(tutorial.run(context(true), { source: 'intent.json', out: 'docs/manual', ifMatch: (await files.stat('docs/manual')).revision })).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(flow).not.toHaveBeenCalled();
  });
  it('removes obsolete generated screenshots inside the same guarded batch', async () => {
    const first = await tutorial.run(context(), { source: 'intent.json', out: 'docs/manual' });
    await put('intent.json', JSON.stringify({ ...plan, steps: [{ ...plan.steps[0], screenshot: false }] }));
    flow.mockResolvedValue({ screenshots: [], browserVersion: 'test-browser' });
    const result = await tutorial.run(context(), { source: 'intent.json', out: 'docs/manual', ifMatch: first.revision! });
    expect(result.changes).toContainEqual(expect.objectContaining({ path: 'docs/manual/screenshots/open.png', operation: 'deleted' }));
  });
  it('rejects missing or mismatched captures without creating output', async () => {
    flow.mockResolvedValue({ screenshots: [], browserVersion: 'test-browser' });
    await expect(tutorial.run(context(), { source: 'intent.json', out: 'docs/manual' })).rejects.toMatchObject({ code: 'BROWSER_FLOW_FAILED' });
    expect(await files.list()).toEqual(['intent.json']);
  });
});
