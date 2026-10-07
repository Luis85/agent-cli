import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import { AppError, ensure, isRecord } from '../domain/errors.ts';
import type { NodeFiles } from './files.ts';
import { validatePluginManifest, type Registry, type Plugin, type PluginManifest } from '../application/plugins.ts';
import type { EventBus } from '../application/events.ts';

async function readManifest(path: string, files: NodeFiles): Promise<PluginManifest> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode((await files.read(path)).bytes);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new AppError('INVALID_PLUGIN', `Invalid JSON in plugin manifest: ${path}`, 2); }
  validatePluginManifest(value);
  return value;
}

async function loadModule(directory: string, files: NodeFiles): Promise<unknown> {
  const esm = `${directory}/main.mjs`;
  try {
    await files.read(esm);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
    const commonjs = `${directory}/main.js`;
    const source = new TextDecoder('utf-8', { fatal: true }).decode((await files.read(commonjs)).bytes);
    const filename = await files.resolvePath(commonjs);
    // Obsidian-style main.js is CommonJS even inside a type:module project.
    // This is execution of trusted code, not a sandbox or dependency installer.
    const module = { exports: {} as unknown };
    const execute = compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname'], { filename });
    execute.call(module.exports, module.exports, createRequire(filename), module, filename, dirname(filename));
    return module.exports;
  }
  const loaded = await import(/* @vite-ignore */ pathToFileURL(await files.resolvePath(esm)).href) as { default?: unknown };
  return loaded.default;
}

/** Only IDs explicitly enabled in project configuration execute code. */
export async function loadEnabledPlugins(directory: string, ids: readonly string[], files: NodeFiles, registry: Registry, events: EventBus): Promise<void> {
  ensure(Array.isArray(ids) && ids.every(id => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id)) && new Set(ids).size === ids.length, 'INVALID_PLUGIN_CONFIG', 'Enabled plugins must contain unique lowercase kebab-case IDs.');
  // Validate every enabled manifest before executing the first plugin module.
  const manifests: PluginManifest[] = [];
  for (const id of ids) {
    const manifest = await readManifest(`${directory}/${id}/manifest.json`, files);
    ensure(manifest.id === id, 'INVALID_PLUGIN', `Manifest id must match plugin directory ${id}.`);
    manifests.push(manifest);
  }
  for (const manifest of manifests) {
    const exported = await loadModule(`${directory}/${manifest.id}`, files);
    const instance: unknown = typeof exported === 'function' ? new (exported as new (manifest: PluginManifest) => unknown)(manifest) : exported;
    ensure(isRecord(instance), 'INVALID_PLUGIN', `Plugin ${manifest.id} must export an object or class.`);
    registry.register(Object.assign(instance, { manifest }) as unknown as Plugin, events);
  }
}
