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
const configSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  paths: z.strictObject({
    projects: relativePath.refine(value => value.toLowerCase() !== 'bin' && !value.toLowerCase().startsWith('bin/'), 'Projects must be outside the fixed bin directory.').default('projects'),
    components: relativePath.default('components'), ui: relativePath.default('src/ui'), stories: relativePath.default('stories'),
    componentImports: relativePath.default('imports/components'), componentExports: relativePath.default('exports/components'),
    interactions: relativePath.default('interactions'), interactionImports: relativePath.default('imports/interactions'), interactionExports: relativePath.default('exports/interactions'),
    dataSources: relativePath.default('data-sources'), dataGenerated: relativePath.default('src/data-sources'),
    dataFixtures: relativePath.default('test-data'), dataImports: relativePath.default('imports/data-sources'), dataExports: relativePath.default('exports/data-sources'),
  }).prefault({}),
  settings: z.strictObject({ language: z.enum(['en', 'de']).default('en'), json: z.boolean().default(false), dryRun: z.boolean().default(false), events: z.enum(eventOutputLevels).default('changes') }).prefault({}),
  templates: z.strictObject({ dateFormat: z.string().min(1).default('YYYY-MM-DD'), timeFormat: z.string().min(1).default('HH:mm') }).prefault({}),
  plugins: z.strictObject({ enabled: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).refine(ids => new Set(ids).size === ids.length, 'Duplicate plugin IDs.').default([]) }).prefault({}),
  ui: z.strictObject({ framework: z.enum(['html', 'htmx', 'vanilla', 'vue', 'svelte', 'react', 'angular']).default('html') }).prefault({}),
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
