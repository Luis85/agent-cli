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
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 10_000);
    try {
      const response = await fetch('/api/system', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store', credentials: 'omit', signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        connection.value = 'unauthorized';
        token = null;
        try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* Storage can be blocked by the browser. */ }
        return;
      }
      if (!response.ok) throw new Error('Server unavailable');
      try { snapshot.value = parseSnapshot(await response.json()); }
      catch { connection.value = 'invalid'; return; }
      connection.value = 'connected';
    } catch {
      if (!disposed) connection.value = 'disconnected';
    } finally {
      clearTimeout(timeout);
      refreshing.value = false;
    }
  }

  function refreshWhenVisible() {
    if (autoRefresh.value && !document.hidden && connection.value !== 'unauthorized') void refresh();
  }
  onMounted(() => {
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* Token still works in memory. */ }
    token = takeToken(window.location, window.history, storage);
    void refresh();
    interval = setInterval(refreshWhenVisible, 15_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
  });
  onUnmounted(() => {
    disposed = true;
    clearInterval(interval);
    controller?.abort();
    document.removeEventListener('visibilitychange', refreshWhenVisible);
  });
  return { snapshot, connection, refreshing, autoRefresh, lastUpdated, refresh };
}
