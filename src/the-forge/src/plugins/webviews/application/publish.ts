import type { CommandContext } from '../../../application/plugins/registry.ts';
import type { FileSnapshot, FileStat, WriteRequest, RemoveRequest } from '../../../domain/documents/file.ts';
import { AppError, ensure } from '../../../domain/shared/errors.ts';
import { ensureWebview, webviewError } from '../domain/errors.ts';

/** Files are relative to the compiled dist directory; the adapter refuses links and special files. */
export type ReadWebviewAssets = (root: string, directory: string) => Promise<FileSnapshot[] | null>;
export interface PublicationFile {
  path: string; sourceRevision: string | null; installedRevision: string | null;
  status: 'missing' | 'changed' | 'unchanged' | 'obsolete';
}
export interface PublicationReport {
  id: string; source: string; destination: string; built: boolean; installed: boolean;
  revision: string | null; current: boolean; files: PublicationFile[];
}

async function optionalStat(context: CommandContext['workspace'], path: string): Promise<FileStat | null> {
  try { return await context.files.stat(path); }
  catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') return null; throw error; }
}

export class WebviewPublication {
  constructor(private readonly readAssets: ReadWebviewAssets) {}

  private async plan(context: CommandContext) {
    const { project, workspace, environment } = context;
    ensure(project, 'PROJECT_REQUIRED', 'Open a webview project before inspecting or publishing it.');
    ensureWebview(project.type === 'webview', 'WEBVIEW_PROJECT_REQUIRED', `Project ${project.name} has type ${project.type}; webview inspects and publishes only webview projects.`, { project: project.name, type: project.type });
    ensure(project.name !== 'admin', 'INVALID_ARGUMENT', 'The admin webview belongs to the Forge distribution and cannot be published here.');
    const id = project.name, destination = `bin/webviews/${id}`;
    const sourceStat = await optionalStat(workspace, 'dist');
    if (sourceStat) ensureWebview(sourceStat.kind === 'folder', 'WEBVIEW_INVALID', 'dist must be a regular directory.');
    const source = await this.readAssets(context.root, 'dist');
    ensure((source === null) === (sourceStat === null), 'CONFLICT', 'The build changed while being inspected. Run the command again.');
    if (source) {
      const manifest = source.find(file => file.path === 'manifest.json');
      ensureWebview(manifest && source.some(file => file.path === 'index.html'), 'WEBVIEW_INVALID', 'dist must contain manifest.json and index.html.');
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest.bytes)); }
      catch { throw webviewError('WEBVIEW_INVALID', 'dist/manifest.json must contain valid UTF-8 JSON.'); }
      ensureWebview(value !== null && typeof value === 'object' && 'id' in value && value.id === id &&
        'name' in value && typeof value.name === 'string' && value.name.trim().length > 0 &&
        'entry' in value && value.entry === 'index.html', 'WEBVIEW_INVALID', 'The build manifest must match the project id and declare a nonempty name and entry index.html.');
      ensure((await workspace.files.stat('dist')).revision === sourceStat!.revision, 'CONFLICT', 'The build changed while being inspected. Run the command again.');
    }
    const installed = await optionalStat(environment, destination);
    if (installed) ensureWebview(installed.kind === 'folder', 'WEBVIEW_INVALID', 'The installed webview must be a regular directory.');
    const existing = new Map<string, FileSnapshot>();
    if (installed?.kind === 'folder') {
      const assets = await this.readAssets(context.workspaceRoot, destination);
      ensure(assets !== null, 'CONFLICT', 'The installed webview changed while being inspected. Run inspect again.');
      for (const file of assets) existing.set(file.path, file);
      ensure((await environment.files.stat(destination)).revision === installed.revision, 'CONFLICT', 'The installed webview changed while being inspected. Run inspect again.');
    }
    const desired = new Map((source ?? []).map(file => [file.path, file]));
    for (const path of desired.keys()) {
      const conflict = [...existing.keys()].find(previous => previous.startsWith(`${path}/`) || path.startsWith(`${previous}/`));
      ensureWebview(conflict === undefined, 'WEBVIEW_INVALID', `Build assets change a file/directory boundary at ${path}. Use a new asset path before publication.`);
    }
    const files: PublicationFile[] = [...new Set([...desired.keys(), ...existing.keys()])].sort().map(path => {
      const next = desired.get(path), previous = existing.get(path);
      return { path, sourceRevision: next?.revision ?? null, installedRevision: previous?.revision ?? null,
        status: !next ? 'obsolete' : !previous ? 'missing' : next.revision === previous.revision ? 'unchanged' : 'changed' };
    });
    const report: PublicationReport = { id, source: 'dist', destination, built: source !== null, installed: installed !== null,
      revision: installed?.revision ?? null, current: source !== null && installed !== null && files.every(file => file.status === 'unchanged'), files };
    return { report, sourceStat, desired, existing };
  }

  async inspect(context: CommandContext): Promise<PublicationReport> { return (await this.plan(context)).report; }

  async publish(context: CommandContext, options: { check?: boolean; ifMatch?: string }) {
    const { report, sourceStat, desired, existing } = await this.plan(context);
    ensureWebview(report.built, 'WEBVIEW_BUILD_REQUIRED', 'Build this project before publication: run npm run build in the selected project.', { ...report });
    if (options.check) {
      ensureWebview(report.current, 'WEBVIEW_DRIFT', 'The installed webview differs from dist. Inspect and publish the reviewed build.', { ...report });
      return { ...report, checked: true, changed: false };
    }
    if (options.ifMatch !== undefined) ensure(options.ifMatch === report.revision, 'CONFLICT', 'The installed webview changed; inspect it again before publishing.', { ...report, expectedRevision: options.ifMatch });
    if (!report.current && report.installed) ensure(options.ifMatch === report.revision, 'CONFLICT', 'Inspect the installed webview and pass its revision with --if-match before replacing it.', { ...report });
    const writes: WriteRequest[] = [], removes: RemoveRequest[] = [];
    for (const file of report.files) {
      const path = `${report.destination}/${file.path}`;
      if (file.status === 'obsolete') removes.push({ path, expectedRevision: existing.get(file.path)!.revision });
      else if (file.status !== 'unchanged') writes.push({ path, bytes: desired.get(file.path)!.bytes, ...(file.installedRevision === null ? {} : { expectedRevision: file.installedRevision }) });
    }
    const result = await context.environment.commit({
      guards: [
        { path: report.destination, ...(report.revision === null ? {} : { expectedRevision: report.revision }) },
        { path: `${context.project!.directory}/dist`, expectedRevision: sourceStat!.revision },
      ], writes, removes,
    }, { operation: 'apply' });
    const revision = result.dryRun ? report.revision : (await context.environment.files.stat(report.destination)).revision;
    return { ...report, installed: result.dryRun ? report.installed : true, revision,
      current: result.dryRun ? report.current : true, changed: writes.length + removes.length > 0, dryRun: result.dryRun, changes: result.changes };
  }
}
