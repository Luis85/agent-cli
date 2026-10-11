import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_KEY, useSystem } from '../../src/composables/useSystem';

const lifecycle = vi.hoisted(() => ({ mounted: [] as Array<() => void>, unmounted: [] as Array<() => void> }));
vi.mock('vue', async importOriginal => ({
  ...await importOriginal<typeof import('vue')>(),
  onMounted: (callback: () => void) => lifecycle.mounted.push(callback),
  onUnmounted: (callback: () => void) => lifecycle.unmounted.push(callback),
}));

const snapshot = {
  schemaVersion: 1, updatedAt: '2026-10-11T12:00:00.000Z',
  availability: { config: true, projects: true, selectedProject: true, plugins: true, capabilities: true },
  server: { pid: 123, port: 54321, uptimeSeconds: 62, startedAt: '2026-10-11T11:59:00.000Z', host: '127.0.0.1', version: '0.1.0', nodeVersion: 'v24.0.0' },
  workspace: { root: '/workspace', projectsPath: 'src', selectedProject: null }, projects: [], plugins: [],
  stats: { projects: 0, plugins: 0, enabledPlugins: 0, commands: 1, generators: 0, skills: 0 }, webviews: [], warnings: [],
};
const success = () => new Response(JSON.stringify({ ok: true, data: snapshot }));
const settle = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
let browser: EventTarget & { location: { hash: string; pathname: string; search: string } };
let documentState: EventTarget & { hidden: boolean };
let storage: Map<string, string>;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  lifecycle.mounted.length = 0;
  lifecycle.unmounted.length = 0;
  storage = new Map();
  const sessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  browser = Object.assign(new EventTarget(), {
    location: { hash: '#token=initial-token', pathname: '/views/admin/', search: '' },
    history: { replaceState: () => { browser.location.hash = ''; } }, sessionStorage,
  });
  documentState = Object.assign(new EventTarget(), { hidden: false });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => success());
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', documentState);
  vi.stubGlobal('sessionStorage', sessionStorage);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  lifecycle.unmounted.forEach(callback => callback());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount() {
  const state = useSystem();
  lifecycle.mounted.forEach(callback => callback());
  await settle();
  return state;
}

describe('system session lifecycle', () => {
  it('recovers a rejected session when a fresh link opens in the same tab', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const state = await mount();
    expect(state.connection.value).toBe('unauthorized');
    expect(storage.has(TOKEN_KEY)).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    browser.location.hash = '#token=fresh-token';
    browser.dispatchEvent(new Event('hashchange'));
    await settle();
    expect(state.connection.value).toBe('connected');
    expect(browser.location.hash).toBe('');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer fresh-token' });
  });

  it('ignores a superseded response while a replacement session connects', async () => {
    let resolveOld!: (value: Response) => void;
    let resolveNew!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
    const state = await mount();
    browser.location.hash = '#token=fresh-token';
    browser.dispatchEvent(new Event('hashchange'));
    resolveOld(new Response(null, { status: 401 }));
    await settle();
    expect(state.refreshing.value).toBe(true);
    expect(storage.get(TOKEN_KEY)).toBe('fresh-token');
    resolveNew(success());
    await settle();
    expect(state.connection.value).toBe('connected');
    expect(state.refreshing.value).toBe(false);
  });

  it('retains the last good snapshot on malformed responses and recovers on refresh', async () => {
    const state = await mount();
    fetchMock.mockResolvedValueOnce(new Response('{broken'));
    await state.refresh();
    expect(state.connection.value).toBe('invalid');
    expect(state.snapshot.value).toEqual(snapshot);
    await state.refresh();
    expect(state.connection.value).toBe('connected');
  });

  it('reports a stalled response body as disconnected after its deadline', async () => {
    fetchMock.mockImplementationOnce(async (_input, options) => ({
      ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    } as Response));
    const state = await mount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.connection.value).toBe('disconnected');
    expect(state.refreshing.value).toBe(false);
  });

  it('pauses polling when hidden or opted out and refreshes on visible return', async () => {
    const state = await mount();
    documentState.hidden = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    documentState.hidden = false;
    documentState.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    state.autoRefresh.value = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
