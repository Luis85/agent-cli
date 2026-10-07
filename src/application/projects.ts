import { AppError, ensure, isRecord } from '../domain/errors.ts';
import { vaultPath, type WriteRequest } from '../domain/file.ts';
import type { FileRepository } from './ports.ts';
import type { Workspace } from './workspace.ts';

export type ComponentKind = 'domain' | 'application';
export interface ProjectMetadata { schemaVersion: 1; name: string; type: 'library' }
export interface ProjectInfo extends ProjectMetadata { directory: string }
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

  async create(name: string) {
    const directory = `${this.projectsDirectory}/${projectName(name)}`;
    ensure(!(await this.files.list()).some(path => path === directory || path.startsWith(directory + '/')), 'PROJECT_EXISTS', `Project directory already contains files: ${directory}`);
    const plan = this.scaffolder.project(name, this.projectsDirectory);
    const result = await this.workspace.write(plan);
    return { project: { schemaVersion: 1, name, type: 'library', directory }, ...result, ...this.preview(plan) };
  }

  async component(name: string, componentName: string, kind: ComponentKind = 'domain') {
    ensure(kind === 'domain' || kind === 'application', 'INVALID_COMPONENT_KIND', 'Component kind must be domain or application.');
    const project = await this.inspect(name);
    const plan = this.scaffolder.component(name, componentName, this.projectsDirectory, kind);
    const result = await this.workspace.write(plan);
    return { project, component: { name: componentName, kind }, ...result, ...this.preview(plan) };
  }

  private preview(plan: readonly WriteRequest[]) {
    return this.workspace.dryRun ? { preview: plan.map(file => ({ path: file.path, content: new TextDecoder().decode(file.bytes) })) } : {};
  }
}
