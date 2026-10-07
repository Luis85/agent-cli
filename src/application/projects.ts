import { AppError, ensure, isRecord } from '../domain/errors.ts';
import { vaultPath, type FileSnapshot, type WriteRequest } from '../domain/file.ts';
import type { FileRepository } from './ports.ts';
import type { Workspace } from './workspace.ts';

export type ComponentKind = 'domain' | 'application';
export interface ProjectMetadata { schemaVersion: 1; name: string; type: 'library' }
export interface ProjectInfo extends ProjectMetadata { directory: string }
interface ProjectSelection { name: string; directory: string }
export interface ProjectScaffolder {
  project(name: string, projectsDirectory: string): readonly WriteRequest[];
  component(projectName: string, componentName: string, projectsDirectory: string, kind: ComponentKind): readonly WriteRequest[];
}

export function projectName(name: string): string {
  ensure(typeof name === 'string' && name.length <= 214 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name), 'INVALID_PROJECT_NAME', 'Use a lowercase kebab-case project name, for example billing-service.');
  return name;
}

/** Owns project discovery and mutation policy; scaffolding and persistence are injected. */
export class ProjectService {
  constructor(private readonly files: FileRepository, private readonly workspace: Workspace, readonly projectsDirectory: string, private readonly scaffolder: ProjectScaffolder) {
    vaultPath(projectsDirectory);
  }

  async list(): Promise<ProjectInfo[]> {
    const prefix = `${this.projectsDirectory}/`;
    const names = (await this.files.list()).filter(path => path.startsWith(prefix))
      .map(path => path.slice(prefix.length)).filter(path => /^[^/]+\/\.forge\/project\.json$/.test(path))
      .map(path => path.split('/')[0]!).sort();
    return Promise.all(names.map(name => this.inspect(name)));
  }

  async inspect(name: string): Promise<ProjectInfo> {
    const directory = `${this.projectsDirectory}/${projectName(name)}`;
    let marker;
    try { marker = await this.files.read(`${directory}/.forge/project.json`); }
    catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') throw new AppError('PROJECT_NOT_FOUND', `No Forge project named ${name} in ${this.projectsDirectory}.`, 3);
      throw error;
    }
    let metadata: unknown;
    try { metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(marker.bytes)); }
    catch { throw new AppError('INVALID_PROJECT', `Invalid project metadata: ${directory}/.forge/project.json`, 2); }
    ensure(isRecord(metadata) && metadata.schemaVersion === 1 && metadata.name === name && metadata.type === 'library', 'INVALID_PROJECT', `Expected schemaVersion 1, matching name and library type in ${directory}/.forge/project.json.`);
    return { schemaVersion: 1, name, type: 'library', directory };
  }

  async current(): Promise<ProjectInfo | null> {
    const context = await this.contextSnapshot();
    const selection = context ? this.contextProject(context) : null;
    if (selection === null) return null;
    const { name, directory } = selection;
    if (directory !== `${this.projectsDirectory}/${name}`) {
      throw new AppError('STALE_PROJECT_CONTEXT', `Selected project ${directory} differs from the configured projects directory. Run project open <name> to explicitly select a project, or project close to clear the selection.`, 3);
    }
    try { return await this.inspect(name); }
    catch (error) {
      if (error instanceof AppError && ['PROJECT_NOT_FOUND', 'INVALID_PROJECT'].includes(error.code)) {
        throw new AppError('STALE_PROJECT_CONTEXT', `Selected project ${name} is missing or invalid. Run project open <name> to select a valid project, or project close to clear the selection.`, 3);
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

  async create(name: string) {
    const directory = `${this.projectsDirectory}/${projectName(name)}`;
    ensure(!(await this.files.list()).some(path => path === directory || path.startsWith(directory + '/')), 'PROJECT_EXISTS', `Project directory already contains files: ${directory}`);
    const plan = this.scaffolder.project(name, this.projectsDirectory);
    const result = await this.workspace.write(plan);
    return { project: { schemaVersion: 1, name, type: 'library', directory }, ...result, ...this.preview(plan), nextSteps: [
      { scope: 'workspace', command: `node bin/app.js project open ${name}` },
      { scope: 'project', directory, command: 'npm install' },
      { scope: 'project', directory, command: 'npm run check' },
      { scope: 'project', directory, command: 'npm run dev' },
    ] };
  }

  async component(name: string, componentName: string, kind: ComponentKind = 'domain') {
    ensure(kind === 'domain' || kind === 'application', 'INVALID_COMPONENT_KIND', 'Component kind must be domain or application.');
    const project = await this.inspect(name);
    const plan = this.scaffolder.component(name, componentName, this.projectsDirectory, kind);
    const result = await this.workspace.write(plan);
    return { project, component: { name: componentName, kind }, ...result, ...this.preview(plan) };
  }

  private async contextSnapshot(): Promise<FileSnapshot | null> {
    try { return await this.files.read('bin/data/context.json'); }
    catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  private contextProject(snapshot: FileSnapshot): ProjectSelection | null {
    try {
      const context: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes));
      ensure(isRecord(context) && context.schemaVersion === 1 && (context.project === null || typeof context.project === 'string'), 'INVALID_PROJECT_CONTEXT', 'Invalid project context.');
      if (context.project === null) return null;
      const name = projectName(context.project);
      ensure(typeof context.directory === 'string' && vaultPath(context.directory).endsWith(`/${name}`), 'INVALID_PROJECT_CONTEXT', 'Project selection requires its workspace-relative directory.');
      return { name, directory: context.directory };
    } catch {
      throw new AppError('INVALID_PROJECT_CONTEXT', 'Invalid bin/data/context.json. Run project open <name> to select a valid project, or project close to clear the selection.', 2);
    }
  }

  private async select(project: ProjectInfo | null) {
    const current = await this.contextSnapshot();
    let unchanged = current === null && project === null;
    if (current) {
      try {
        const selection = this.contextProject(current);
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
    return { project, ...result, ...this.preview(plan) };
  }

  private preview(plan: readonly WriteRequest[]) {
    return this.workspace.dryRun ? { preview: plan.map(file => ({ path: file.path, content: new TextDecoder().decode(file.bytes) })) } : {};
  }
}
