/** Read-only HTTP API contract; independent of any webview implementation. */
export interface ServerProject {
  schemaVersion: number;
  name: string;
  type: string;
  directory: string;
}
export interface ServerPlugin {
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
export interface WebviewInfo { id: string; name: string; path: string }
export interface ServerInfo {
  pid: number;
  startedAt: string;
  host: '127.0.0.1';
  port: number;
  version: string;
  nodeVersion: string;
  uptimeSeconds: number;
}
export interface SystemSnapshot {
  schemaVersion: 1;
  updatedAt: string;
  availability: { config: boolean; projects: boolean; selectedProject: boolean; plugins: boolean; capabilities: boolean };
  server: ServerInfo;
  workspace: { root: string; projectsPath: string; selectedProject: ServerProject | null };
  projects: ServerProject[];
  plugins: ServerPlugin[];
  stats: { projects: number; plugins: number; enabledPlugins: number; commands: number; generators: number; skills: number };
  webviews: WebviewInfo[];
  warnings: string[];
}
export interface ServerStatus {
  running: boolean;
  stale: boolean;
  server: ServerInfo | null;
  url: string | null;
  webviews: WebviewInfo[];
  dryRun?: boolean;
  changed?: boolean;
}
export interface ServerController {
  start(options: { port?: number; webview?: string; dryRun: boolean }): Promise<ServerStatus>;
  status(): Promise<ServerStatus>;
  stop(options: { dryRun: boolean }): Promise<ServerStatus>;
}
