import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { AppError } from '../domain/errors.ts';
import { vaultPath } from '../domain/file.ts';
import type { LoadedConfig } from '../application/config.ts';

const relativePath = z.string().min(1).transform(value => value.replace(/\/+$/, '')).refine(value => {
  try { vaultPath(value); return true; } catch { return false; }
}, 'Must be a contained workspace-relative path.');
const configSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  paths: z.strictObject({
    root: z.string().min(1).default('..'), projects: relativePath.default('projects'),
    templates: relativePath.default('templates'), output: relativePath.default('notes'),
    generated: relativePath.default('src/domain'), plugins: relativePath.default('.agent-cli/plugins'),
    skills: relativePath.default('.agents/skills'),
  }).prefault({}),
  settings: z.strictObject({ json: z.boolean().default(false), dryRun: z.boolean().default(false) }).prefault({}),
  templates: z.strictObject({ dateFormat: z.string().min(1).default('YYYY-MM-DD'), timeFormat: z.string().min(1).default('HH:mm') }).prefault({}),
  plugins: z.strictObject({ enabled: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).refine(ids => new Set(ids).size === ids.length, 'Duplicate plugin IDs.').default([]) }).prefault({}),
});

export async function loadConfig(options: { defaultPath: string; explicitPath?: string; cwd: string; root?: string }): Promise<LoadedConfig> {
  const path = resolve(options.cwd, options.explicitPath ?? options.defaultPath);
  let content: unknown;
  let exists = true;
  try { content = JSON.parse(await readFile(path, 'utf8')) as unknown; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !options.explicitPath) { content = {}; exists = false; }
    else throw new AppError('INVALID_CONFIG', `Cannot read configuration ${path}: ${error instanceof Error ? error.message : String(error)}`, 2);
  }
  const parsed = configSchema.safeParse(content);
  if (!parsed.success) throw new AppError('INVALID_CONFIG', parsed.error.issues.map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; '), 2);
  const config = parsed.data;
  config.paths.root = options.root !== undefined ? resolve(options.cwd, options.root) : exists ? resolve(dirname(path), config.paths.root) : options.cwd;
  return { path: exists ? path : null, config };
}
