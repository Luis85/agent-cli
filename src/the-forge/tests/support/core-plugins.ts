/**
 * The bundled core plugin ids in bundle (registration and activation) order, as `src/main.ts` lists them. Event
 * sequence and plugin catalog tests derive their expectations from this list.
 */
export const bundledCorePlugins = ['bases', 'skills', 'search', 'links', 'agents', 'connector', 'connector-azure-devops', 'backlog'] as const;

/** Host services for core plugins that must not reach the network or read credentials in a test. */
export const offlineHost = {
  http: { request: () => Promise.reject(new Error('This test makes no HTTP requests.')) },
  environment: () => undefined,
  locks: () => async () => async () => true,
};
