import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { isRecord } from '../../domain/shared/errors.ts';
import type { ServerInfo, ServerPlugin, ServerProject, SystemSnapshot, WebviewInfo } from '../../application/server/contracts.ts';

export interface SnapshotOptions {
  workspaceRoot: string;
  distributionPath: string;
  server: () => ServerInfo;
  webviews: WebviewInfo[];
  signal?: AbortSignal;
}
function command(options: SnapshotOptions, args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [join(options.distributionPath, 'forge.js'), '--root', options.workspaceRoot, '--json', '--events', 'none', '--dry-run', ...args],
      { cwd: options.workspaceRoot, timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, signal: options.signal }, (error, stdout) => {
        if (error) { reject(new Error('Inspection command failed.')); return; }
        try {
          const response: unknown = JSON.parse(stdout);
          if (!isRecord(response) || response.ok !== true || !isRecord(response.data)) throw new Error('Invalid inspection response.');
          resolve(response.data);
        } catch { reject(new Error('Invalid inspection response.')); }
      });
  });
}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
function project(value: unknown): ServerProject | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.type !== 'string' || typeof value.directory !== 'string') return null;
  return { schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : 1, name: value.name, type: value.type, directory: value.directory };
}
function plugins(value: unknown): ServerPlugin[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).filter(value => typeof value.id === 'string').map(value => {
    const contributions = isRecord(value.contributions) ? value.contributions : {};
    return {
      id: String(value.id), name: typeof value.name === 'string' ? value.name : String(value.id),
      version: typeof value.version === 'string' ? value.version : '', core: value.core === true,
      state: typeof value.state === 'string' ? value.state : 'unknown', description: typeof value.description === 'string' ? value.description : '',
      // Plugin failure messages can include arbitrary secrets; only report a generic reason.
      ...(value.reason ? { reason: 'Plugin unavailable. Inspect the CLI plugin report locally for details.' } : {}),
      commands: strings(contributions.commands), generators: strings(contributions.generators), skills: strings(contributions.skills),
    };
  });
}

/** Uses only fixed discovery commands and projects a credential-free public model. */
export function createSnapshotProvider(options: SnapshotOptions): () => Promise<SystemSnapshot> {
  let cached: SystemSnapshot | undefined;
  let pending: Promise<SystemSnapshot> | undefined;
  async function collect(): Promise<SystemSnapshot> {
    const requests = [['config'], ['project', 'list'], ['project', 'current'], ['plugins'], ['help']];
    const results = await Promise.allSettled(requests.map(args => command(options, args)));
    const warnings: string[] = [];
    const data = results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      warnings.push(`Could not inspect ${requests[index]!.join(' ')}. Retry or inspect this command through the CLI.`);
      return {} as Record<string, unknown>;
    });
    const configuration = isRecord(data[0]!.config) ? data[0]!.config : {};
    const paths = isRecord(configuration.paths) ? configuration.paths : {};
    const projectList = Array.isArray(data[1]!.projects) ? data[1]!.projects : [];
    const projects = projectList.map(project).filter((item): item is ServerProject => item !== null);
    const pluginList = plugins(data[3]!.plugins);
    const enabled = pluginList.filter(plugin => plugin.state === 'enabled');
    const commands = Array.isArray(data[4]!.commands) ? data[4]!.commands.length : 0;
    const snapshot: SystemSnapshot = {
      schemaVersion: 1, updatedAt: new Date().toISOString(), server: options.server(),
      availability: { config: results[0]!.status === 'fulfilled', projects: results[1]!.status === 'fulfilled',
        selectedProject: results[2]!.status === 'fulfilled', plugins: results[3]!.status === 'fulfilled', capabilities: results[4]!.status === 'fulfilled' },
      workspace: { root: options.workspaceRoot, projectsPath: typeof paths.projects === 'string' ? paths.projects : '', selectedProject: project(data[2]!.project) },
      projects, plugins: pluginList, webviews: options.webviews,
      stats: { projects: projects.length, plugins: pluginList.length, enabledPlugins: enabled.length, commands,
        generators: Array.isArray(data[4]!.generators) ? data[4]!.generators.length : 0, skills: strings(data[4]!.skills).length },
      warnings,
    };
    cached = snapshot;
    return snapshot;
  }
  return async () => {
    if (cached && Date.now() - Date.parse(cached.updatedAt) < 3000) return { ...cached, server: options.server() };
    if (!pending) pending = collect().finally(() => { pending = undefined; });
    return pending;
  };
}
