/** Versioned HTTP transport contract. This project has no runtime dependency on the CLI. */
export interface Project {
  schemaVersion: number;
  name: string;
  type: string;
  directory: string;
}
export interface Plugin {
  id: string;
  name: string;
  version: string;
  core: boolean;
  state: string;
  description: string;
  reason?: string;
  commands: string[];
  generators: string[];
  skills: string[];
}
export interface SystemSnapshot {
  schemaVersion: 1;
  availability: { config: boolean; projects: boolean; selectedProject: boolean; plugins: boolean; capabilities: boolean };
  updatedAt: string;
  server: {
    pid: number;
    startedAt: string;
    host: '127.0.0.1';
    port: number;
    version: string;
    nodeVersion: string;
    uptimeSeconds: number;
  };
  workspace: { root: string; projectsPath: string; selectedProject: Project | null };
  projects: Project[];
  plugins: Plugin[];
  stats: { projects: number; plugins: number; enabledPlugins: number; commands: number; generators: number; skills: number };
  webviews: { id: string; name: string; path: string }[];
  warnings: string[];
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const fields = (value: RecordValue, keys: string[], type: 'string' | 'number') => keys.every(key =>
  type === 'number' ? typeof value[key] === 'number' && Number.isFinite(value[key]) : typeof value[key] === 'string');
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const project = (value: unknown): value is Project => record(value) && fields(value, ['name', 'type', 'directory'], 'string')
  && count(value.schemaVersion) && value.schemaVersion > 0;
const plugin = (value: unknown): value is Plugin => record(value)
  && fields(value, ['id', 'name', 'version', 'state', 'description'], 'string') && typeof value.core === 'boolean'
  && (value.reason === undefined || typeof value.reason === 'string')
  && ['commands', 'generators', 'skills'].every(key => strings(value[key]));

export function parseSnapshot(response: unknown): SystemSnapshot {
  if (!record(response) || response.ok !== true || !record(response.data)) throw new Error('Invalid system response');
  const data = response.data;
  if (data.schemaVersion !== 1 || !record(data.availability)
    || !['config', 'projects', 'selectedProject', 'plugins', 'capabilities'].every(key => typeof (data.availability as RecordValue)[key] === 'boolean')
    || !timestamp(data.updatedAt)
    || !record(data.server) || !count(data.server.pid) || data.server.pid === 0
    || !count(data.server.port) || data.server.port === 0 || data.server.port > 65535
    || typeof data.server.uptimeSeconds !== 'number' || !Number.isFinite(data.server.uptimeSeconds) || data.server.uptimeSeconds < 0
    || !timestamp(data.server.startedAt)
    || !fields(data.server, ['startedAt', 'version', 'nodeVersion'], 'string') || data.server.host !== '127.0.0.1'
    || !record(data.workspace) || !fields(data.workspace, ['root', 'projectsPath'], 'string')
    || !(data.workspace.selectedProject === null || project(data.workspace.selectedProject))
    || !Array.isArray(data.projects) || !data.projects.every(project)
    || !Array.isArray(data.plugins) || !data.plugins.every(plugin)
    || !record(data.stats) || !['projects', 'plugins', 'enabledPlugins', 'commands', 'generators', 'skills'].every(key => count((data.stats as RecordValue)[key]))
    || !Array.isArray(data.webviews) || !data.webviews.every(view => record(view) && fields(view, ['id', 'name', 'path'], 'string'))
    || !strings(data.warnings)) throw new Error('Invalid system response');
  return data as unknown as SystemSnapshot;
}

export function formatUptime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return 'Less than a minute';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ${minutes % 60} min`;
}

export function filterPlugins(plugins: Plugin[], search: string, state: string): Plugin[] {
  const query = search.trim().toLocaleLowerCase();
  return plugins.filter(plugin => (state === 'all' || plugin.state === state)
    && `${plugin.name} ${plugin.id} ${plugin.description}`.toLocaleLowerCase().includes(query));
}
