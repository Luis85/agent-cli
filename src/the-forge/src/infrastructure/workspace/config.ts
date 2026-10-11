import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { forgeError, errorMessage } from '../../domain/shared/errors.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import type { LoadedConfig } from '../../application/workspace/config.ts';
import { eventOutputLevels } from '../../application/plugins/event-output.ts';

const relativePath = z.string().min(1).transform(value => value.replace(/\/+$/, '')).refine(value => {
  try { vaultPath(value); return true; } catch { return false; }
}, 'Must be a contained workspace-relative path.');
const pluginIds = z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).refine(ids => new Set(ids).size === ids.length, 'Duplicate plugin IDs.').default([]);
const configSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  paths: z.strictObject({
    projects: relativePath.refine(value => value.toLowerCase() !== 'bin' && !value.toLowerCase().startsWith('bin/'), 'Projects must be outside the fixed bin directory.').default('projects'),
  }).prefault({}),
  settings: z.strictObject({ language: z.enum(['en', 'de']).default('en'), json: z.boolean().default(false), dryRun: z.boolean().default(false), events: z.enum(eventOutputLevels).default('changes') }).prefault({}),
  // Plugin sections are validated against the schemas that registered plugins declare once they load.
  plugins: z.strictObject({
    enabled: pluginIds, disabled: pluginIds,
    settings: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use a plugin id.'), z.unknown()).default({}),
  }).prefault({}),
});

export async function loadConfig(options: { defaultPath: string; cwd: string; root?: string }): Promise<LoadedConfig> {
  const root = options.root !== undefined ? resolve(options.cwd, options.root) : resolve(dirname(options.defaultPath), '..');
  const path = resolve(root, 'bin/config.json');
  let content: unknown;
  let exists = true;
  try { content = JSON.parse(await readFile(path, 'utf8')) as unknown; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { content = {}; exists = false; }
    else throw forgeError('INVALID_CONFIG', `Cannot read configuration ${path}: ${errorMessage(error)}`);
  }
  const parsed = configSchema.safeParse(content);
  if (!parsed.success) throw forgeError('INVALID_CONFIG', parsed.error.issues.map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; '));
  const config = parsed.data;
  return { path: exists ? path : null, root, config };
}
