/**
 * The bundled core plugin ids in bundle (registration and activation) order, as `src/main.ts` lists them. Event
 * sequence and plugin catalog tests derive their expectations from this list.
 */
export const bundledCorePlugins = ['bases', 'skills', 'search', 'links', 'agents', 'backlog', 'ui', 'data-sources'] as const;
