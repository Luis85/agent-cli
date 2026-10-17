import { forgeError, AppError, ensure, isRecord } from '../../domain/shared/errors.ts';
import { isNotFound, readOrMissing } from '../../domain/shared/not-found.ts';
import { vaultPath, type FileSnapshot, type WriteRequest } from '../../domain/documents/file.ts';
import type { FileRepository } from '../workspace/ports.ts';
import type { Workspace } from '../workspace/workspace.ts';
import type { EventBus } from '../plugins/events.ts';
import { publishHostEvent } from '../plugins/host-events.ts';
import { decodeUtf8 } from '../../domain/shared/utf8.ts';

export type ComponentKind = 'domain' | 'application';
export type ProjectType = 'library' | 'webview';
export interface ProjectMetadata { schemaVersion: 1; name: string; type: ProjectType }
export interface ProjectInfo extends ProjectMetadata { directory: string }
/** A directory with a project marker that does not describe a valid project, with the failure it reports. */
export interface InvalidProject { directory: string; code: string; reason: string }
interface ProjectSelection { name: string; directory: string }
/**
 * The files of a new project and of a project component. The `scaffolds` core plugin provides it as the service
 * `scaffolds.projects`; `project create` and `project component` fail with PLUGIN_UNAVAILABLE without it.
 */
export interface ProjectScaffolder {
  project(name: string, projectsDirectory: string, type?: ProjectType): readonly WriteRequest[];
  component(projectName: string, componentName: string, projectsDirectory: string, kind: ComponentKind): readonly WriteRequest[];
}
export const projectScaffolderService = 'scaffolds.projects';
/** Resolves the scaffolder when a `project create` or `project component` action needs it. */
export type ProjectScaffolderLookup = (action: 'create' | 'component') => ProjectScaffolder;

export function projectName(name: string, type: ProjectType = 'library'): string {
  ensure(typeof name === 'string' && name.length <= 214 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name), 'INVALID_PROJECT_NAME', 'Use a lowercase kebab-case project name, for example billing-service.');
  ensure(type !== 'webview' || name !== 'admin', 'INVALID_PROJECT_NAME', 'The webview id admin is reserved for the packaged developer view. Choose another project name.');
  return name;
}

/** Owns project discovery and mutation policy; scaffolding and persistence are injected. */
export class ProjectService {
  constructor(private readonly files: FileRepository, private readonly workspace: Workspace, readonly projectsDirectory: string, private readonly scaffolder: ProjectScaffolderLookup, private readonly events: EventBus) {
    vaultPath(projectsDirectory);
  }

  /** Every valid project, and every directory whose project marker is invalid, so one bad project hides no other. */
  async discover(): Promise<{ projects: ProjectInfo[]; invalid: InvalidProject[] }> {
    const entries = await this.inspectAll();
    return { projects: entries.flatMap(entry => entry.project ?? []), invalid: entries.flatMap(entry => entry.invalid ?? []) };
  }

  /** Every project; an invalid one fails, so callers that act on all projects never act on a partial set. */
  async list(): Promise<ProjectInfo[]> {
    const entries = await this.inspectAll();
    const failed = entries.find(entry => entry.error !== undefined);
    if (failed) throw failed.error;
    return entries.flatMap(entry => entry.project ?? []);
  }

  /** Each marked project directory in name order: its project, or the INVALID_PROJECT(_NAME) failure it reports. */
  private async inspectAll(): Promise<Array<{ project?: ProjectInfo; invalid?: InvalidProject; error?: AppError }>> {
    const prefix = `${this.projectsDirectory}/`;
    const names = (await this.files.list()).filter(path => path.startsWith(prefix))
      .map(path => path.slice(prefix.length)).filter(path => /^[^/]+\/\.forge\/project\.json$/.test(path))
      .map(path => path.split('/')[0]!).sort();
    return Promise.all(names.map(async name => {
      try { return { project: await this.inspect(name) }; }
      catch (error) {
        if (!(error instanceof AppError) || !['INVALID_PROJECT', 'INVALID_PROJECT_NAME'].includes(error.code)) throw error;
        return { error, invalid: { directory: `${prefix}${name}`, code: error.code, reason: error.message } };
      }
    }));
  }

  async inspect(name: string): Promise<ProjectInfo> {
    const directory = `${this.projectsDirectory}/${projectName(name)}`;
    let marker;
    try { marker = await this.files.read(`${directory}/.forge/project.json`); }
    catch (error) {
      if (isNotFound(error)) throw forgeError('PROJECT_NOT_FOUND', `No Forge project named ${name} in ${this.projectsDirectory}.`);
      throw error;
    }
    let metadata: unknown;
    try { metadata = JSON.parse(decodeUtf8(marker.bytes)); }
    catch { throw forgeError('INVALID_PROJECT', `Invalid project metadata: ${directory}/.forge/project.json`, { directory }); }
    const path = `${directory}/.forge/project.json`;
    ensure(isRecord(metadata) && metadata.schemaVersion === 1, 'INVALID_PROJECT', `Expected schemaVersion 1 in ${path}.`, { directory });
    ensure(metadata.name === name, 'INVALID_PROJECT', `${path} names the project ${JSON.stringify(metadata.name)}, but its directory is ${name}; set name to ${name} or rename the directory to match.`, { directory, expected: name, found: metadata.name ?? null });
    ensure(metadata.type === 'library' || metadata.type === 'webview', 'INVALID_PROJECT', `Expected type library or webview in ${path}.`, { directory });
    return { schemaVersion: 1, name, type: metadata.type, directory };
  }

  async current(): Promise<ProjectInfo | null> {
    const context = await this.contextSnapshot();
    const selection = context ? this.contextProject(context) : null;
    if (selection === null) return null;
    const { name, directory } = selection;
    if (directory !== `${this.projectsDirectory}/${name}`) {
      throw forgeError('STALE_PROJECT_CONTEXT', `Selected project ${directory} differs from the configured projects directory. Run project open <name> to explicitly select a project, or project close to clear the selection.`, { project: name, directory, projectsDirectory: this.projectsDirectory });
    }
    try { return await this.inspect(name); }
    catch (error) {
      if (error instanceof AppError && ['PROJECT_NOT_FOUND', 'INVALID_PROJECT'].includes(error.code)) {
        throw forgeError('STALE_PROJECT_CONTEXT', `Selected project ${name} is missing or invalid. Run project open <name> to select a valid project, or project close to clear the selection.`, { project: name, directory, cause: error.code, reason: error.message });
      }
      throw error;
    }
  }

  async requireCurrent(): Promise<ProjectInfo> {
    const project = await this.current();
    ensure(project !== null, 'PROJECT_REQUIRED', 'No project is selected. Run project list, then project open <name> before using this command.');
    return project;
  }

  async open(name: string) {
    return this.select(await this.inspect(name));
  }

  async close() {
    return this.select(null);
  }

  async create(name: string, type: ProjectType = 'library') {
    ensure(type === 'library' || type === 'webview', 'INVALID_ARGUMENT', 'Project type must be library or webview.');
    const directory = `${this.projectsDirectory}/${projectName(name, type)}`;
    ensure(!(await this.files.list()).some(path => path === directory || path.startsWith(directory + '/')), 'PROJECT_EXISTS', `Project directory already contains files: ${directory}`);
    const plan = this.scaffolder('create').project(name, this.projectsDirectory, type);
    const result = await this.workspace.write(plan);
    return { project: { schemaVersion: 1, name, type, directory }, ...result, ...this.preview(plan), nextSteps: [
      { scope: 'workspace', command: `node bin/forge.js project open ${name}` },
      { scope: 'project', directory, command: 'npm install' },
      { scope: 'project', directory, command: type === 'webview' ? 'npm run build' : 'npm run check' },
      ...(type === 'webview' ? [
        { scope: 'workspace', command: `node bin/forge.js webview publish --project ${name} --dry-run` },
        { scope: 'workspace', command: `node bin/forge.js webview publish --project ${name}` },
        { scope: 'workspace', command: `node bin/forge.js server start --webview ${name}` },
      ] : [{ scope: 'project', directory, command: 'npm run dev' }]),
    ] };
  }

  async component(name: string, componentName: string, kind: ComponentKind = 'domain') {
    ensure(kind === 'domain' || kind === 'application', 'INVALID_COMPONENT_KIND', 'Component kind must be domain or application.');
    const project = await this.inspect(name);
    const plan = this.scaffolder('component').component(name, componentName, this.projectsDirectory, kind);
    const result = await this.workspace.write(plan);
    return { project, component: { name: componentName, kind }, ...result, ...this.preview(plan) };
  }

  private async contextSnapshot(): Promise<FileSnapshot | null> {
    return (await readOrMissing(() => this.files.read('bin/data/context.json'))) ?? null;
  }

  private contextProject(snapshot: FileSnapshot): ProjectSelection | null {
    try {
      const context: unknown = JSON.parse(decodeUtf8(snapshot.bytes));
      ensure(isRecord(context) && context.schemaVersion === 1 && (context.project === null || typeof context.project === 'string'), 'INVALID_PROJECT_CONTEXT', 'Invalid project context.');
      if (context.project === null) return null;
      const name = projectName(context.project);
      ensure(typeof context.directory === 'string' && vaultPath(context.directory).endsWith(`/${name}`), 'INVALID_PROJECT_CONTEXT', 'Project selection requires its workspace-relative directory.');
      return { name, directory: context.directory };
    } catch {
      throw forgeError('INVALID_PROJECT_CONTEXT', 'Invalid bin/data/context.json. Run project open <name> to select a valid project, or project close to clear the selection.');
    }
  }

  /** A committed selection change emits `workspace.project-change` with the previous and new project names. */
  private async select(project: ProjectInfo | null) {
    const current = await this.contextSnapshot();
    let unchanged = current === null && project === null, from: string | null = null;
    if (current) {
      try {
        const selection = this.contextProject(current);
        from = selection?.name ?? null;
        unchanged = project === null ? selection === null : selection?.name === project.name && selection.directory === project.directory;
      }
      catch (error) {
        if (!(error instanceof AppError && error.code === 'INVALID_PROJECT_CONTEXT')) throw error;
      }
    }
    const plan: WriteRequest[] = unchanged ? [] : [{
      path: 'bin/data/context.json',
      bytes: new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, project: project?.name ?? null, ...(project ? { directory: project.directory } : {}) }, null, 2) + '\n'),
      ...(current ? { expectedRevision: current.revision } : {}),
    }];
    const result = unchanged ? { dryRun: this.workspace.dryRun, changes: [] } : await this.workspace.write(plan);
    const to = project?.name ?? null;
    if (!unchanged && !this.workspace.dryRun && from !== to) await publishHostEvent(this.events, 'workspace.project-change', { from, to });
    return { project, ...result, ...this.preview(plan) };
  }

  private preview(plan: readonly WriteRequest[]) {
    return this.workspace.dryRun ? { preview: plan.map(file => ({ path: file.path, content: new TextDecoder().decode(file.bytes) })) } : {};
  }
}
