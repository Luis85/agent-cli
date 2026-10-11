import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { parseSnapshot, type SystemSnapshot } from '../system';

export const TOKEN_KEY = 'forge.admin.token';
export type Connection = 'loading' | 'connected' | 'disconnected' | 'unauthorized' | 'invalid';

/** Fragments are never sent in HTTP requests; clear before making any request. */
export function takeToken(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState'>, storage?: Pick<Storage, 'getItem' | 'setItem'>): string | null {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const supplied = fragment.get('token');
  if (fragment.has('token')) history.replaceState(null, '', `${location.pathname}${location.search}`);
  try {
    if (supplied) storage?.setItem(TOKEN_KEY, supplied);
    return supplied || storage?.getItem(TOKEN_KEY) || null;
  } catch {
    return supplied || null;
  }
}

export function useSystem() {
  const snapshot = shallowRef<SystemSnapshot | null>(null);
  const connection = ref<Connection>('loading');
  const refreshing = ref(false);
  const autoRefresh = ref(true);
  const lastUpdated = computed(() => snapshot.value ? new Date(snapshot.value.updatedAt).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) : null);
  let token: string | null = null;
  let interval: ReturnType<typeof setInterval> | undefined;
  let controller: AbortController | undefined;
  let disposed = false;

  async function refresh() {
    if (refreshing.value || disposed) return;
    if (!token) { connection.value = 'unauthorized'; return; }
    refreshing.value = true;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 10_000);
    try {
      const response = await fetch('/api/system', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store', credentials: 'omit', signal: request.signal,
      });
      if (disposed || controller !== request) return;
      if (response.status === 401 || response.status === 403) {
        connection.value = 'unauthorized';
        token = null;
        try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* Storage can be blocked by the browser. */ }
        return;
      }
      if (!response.ok) throw new Error('Server unavailable');
      try {
        const nextSnapshot = parseSnapshot(await response.json());
        if (disposed || controller !== request) return;
        snapshot.value = nextSnapshot;
      } catch {
        if (!disposed && controller === request) connection.value = request.signal.aborted ? 'disconnected' : 'invalid';
        return;
      }
      connection.value = 'connected';
    } catch {
      if (!disposed && controller === request) connection.value = 'disconnected';
    } finally {
      clearTimeout(timeout);
      if (controller === request) {
        controller = undefined;
        refreshing.value = false;
      }
    }
  }

  function refreshWhenVisible() {
    if (autoRefresh.value && !document.hidden && connection.value !== 'unauthorized') void refresh();
  }
  function acceptToken() {
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* Token still works in memory. */ }
    token = takeToken(window.location, window.history, storage);
    controller?.abort();
    controller = undefined;
    refreshing.value = false;
    connection.value = 'loading';
    void refresh();
  }
  function acceptFragment() {
    if (new URLSearchParams(window.location.hash.slice(1)).has('token')) acceptToken();
  }
  onMounted(() => {
    acceptToken();
    interval = setInterval(refreshWhenVisible, 15_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('hashchange', acceptFragment);
  });
  onUnmounted(() => {
    disposed = true;
    clearInterval(interval);
    controller?.abort();
    document.removeEventListener('visibilitychange', refreshWhenVisible);
    window.removeEventListener('hashchange', acceptFragment);
  });
  return { snapshot, connection, refreshing, autoRefresh, lastUpdated, refresh };
}
