import { pathToFileURL } from 'node:url';
import { ensure, isRecord } from '../domain/errors.ts';
import type { NodeFiles } from './files.ts';
import type { Registry, Plugin } from '../application/plugins.ts';
import type { EventBus } from '../application/events.ts';

/** Loading is explicit: --plugins names a trusted project-relative JSON manifest. */
export async function loadPlugins(path: string, files: NodeFiles, registry: Registry, events: EventBus): Promise<void> {
  const config: unknown = JSON.parse(Buffer.from((await files.read(path)).bytes).toString('utf8'));
  ensure(isRecord(config) && config.apiVersion === 1 && Array.isArray(config.plugins), 'INVALID_PLUGIN_CONFIG', 'Expected { apiVersion: 1, plugins: ["plugins/example.mjs"] }.');
  for (const entry of config.plugins) {
    ensure(typeof entry === 'string' && /\.(mjs|cjs)$/.test(entry), 'INVALID_PLUGIN_CONFIG', 'Plugins must be project-relative .mjs or .cjs files.');
    const module = await import(/* @vite-ignore */ pathToFileURL(await files.resolvePath(entry)).href) as { default: Plugin };
    registry.register(module.default, events);
  }
}
