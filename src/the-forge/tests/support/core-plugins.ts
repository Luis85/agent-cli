import type { CorePluginHost } from '../../src/application/plugins/core-plugins.ts';

/**
 * The bundled core plugin ids in bundle (registration and activation) order, as `src/main.ts` lists them. Event
 * sequence and plugin catalog tests derive their expectations from this list.
 */
export const bundledCorePlugins = [
  'templates', 'scaffolds', 'ui', 'data-sources', 'claude',
  'bases', 'skills', 'search', 'links', 'agents', 'connector', 'connector-azure-devops', 'backlog',
] as const;

/**
 * A `CorePluginHost` for tests: each port fails when used unless `ports` supplies it, so a test states exactly which
 * kernel ports the plugins under test need.
 */
export function testHost(ports: Partial<CorePluginHost> = {}): CorePluginHost {
  const unused = (port: string) => (): never => { throw new Error(`The test host does not provide ${port}.`); };
  return {
    skills: { list: () => [], get: () => undefined },
    fileDates: unused('fileDates'), openFiles: unused('openFiles'), operationId: unused('operationId'),
    http: { request: unused('http') }, locks: unused('locks'), environment: unused('environment'),
    ...ports,
  };
}

/** Host ports for core plugins that must not reach the network or read credentials in a test. */
export const offlineHost: Pick<CorePluginHost, 'http' | 'environment' | 'locks'> = {
  http: { request: () => Promise.reject(new Error('This test makes no HTTP requests.')) },
  environment: () => undefined,
  locks: () => async () => async () => true,
};
