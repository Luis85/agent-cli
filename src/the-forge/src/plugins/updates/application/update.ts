import type { CommandContext } from '../../../application/plugins/registry.ts';
import type { FileSnapshot, WriteRequest, RemoveRequest } from '../../../domain/documents/file.ts';
import { AppError, ensure } from '../../../domain/shared/errors.ts';
import { compareVersions, distributionFiles, releaseVersion, releaseJson, requireUpdate, updateError, type DistributionPolicy } from '../domain/release.ts';

export interface ReleaseAssets { version: string; checksum: string; files: FileSnapshot[] }
export interface ReleaseSource { latest(): Promise<string>; download(version: string): Promise<ReleaseAssets> }
export class AppUpdate {
  constructor(private readonly source: ReleaseSource, private readonly policy: DistributionPolicy) {}
  private async installed(context: CommandContext) {
    // An externally routed workspace must update its own app, never the caller's distribution.
    let pkg: FileSnapshot;
    try { pkg = await context.environment.files.read('bin/package.json'); }
    catch { throw updateError('UPDATE_SCOPE_INVALID', 'The target workspace has no installed Forge app. Install a release first.'); }
    const data = releaseJson(pkg.bytes);
    requireUpdate(data !== null && typeof data === 'object' && 'name' in data && data.name === 'forge-bundle' && 'version' in data && typeof data.version === 'string', 'bin/package.json does not identify a Forge distribution.');
    const version = releaseVersion(data.version);
    const manifest = await context.environment.files.read('bin/data/distribution.json');
    const owned = distributionFiles(releaseJson(manifest.bytes), this.policy);
    const stat = await context.environment.files.stat('bin');
    ensure(stat.kind === 'folder', 'INVALID_PATH', 'bin must be a regular folder.');
    return { version, revision: stat.revision, owned };
  }
  async check(context: CommandContext, target?: string) {
    const installed = await this.installed(context);
    const version = releaseVersion(target ?? await this.source.latest());
    return { installedVersion: installed.version, releaseVersion: version, available: compareVersions(version, installed.version) > 0,
      revision: installed.revision, releaseUrl: `https://github.com/Luis85/agent-cli/releases/tag/v${version}` };
  }
  async apply(context: CommandContext, version: string, ifMatch: string) {
    const installed = await this.installed(context);
    ensure(ifMatch === installed.revision, 'CONFLICT', 'The app or workspace settings changed; run update check again.', { currentRevision: installed.revision });
    requireUpdate(compareVersions(version, installed.version) >= 0, 'Downgrading the installed app is not supported.');
    // A preview neither downloads nor runs the release: it reports the guarded plan the real apply would follow.
    if (context.environment.dryRun) {
      return { installedVersion: installed.version, releaseVersion: releaseVersion(version), checksum: null, downloaded: false,
        changed: version !== installed.version, dryRun: true, changes: [], revision: installed.revision, restartRequired: false };
    }
    const release = await this.source.download(releaseVersion(version));
    requireUpdate(release.version === version, 'Downloaded release version differs from the requested version.');
    const desired = new Map(release.files.map(file => [file.path, file]));
    const manifest = desired.get('data/distribution.json');
    requireUpdate(manifest, 'Downloaded release has no distribution manifest.');
    const paths = distributionFiles(releaseJson(manifest.bytes), this.policy);
    requireUpdate(paths.length === desired.size && paths.every(path => desired.has(path)), 'Downloaded release assets disagree with its manifest.');
    const writes: WriteRequest[] = [], removes: RemoveRequest[] = [];
    const previous = new Map<string, FileSnapshot>();
    for (const path of [...new Set([...paths, ...installed.owned])].sort()) {
      const destination = `bin/${path}`;
      let current: FileSnapshot | undefined;
      try { current = await context.environment.files.read(destination); }
      catch (error) { if (!(error instanceof AppError && error.code === 'NOT_FOUND')) throw error; }
      if (current) previous.set(destination, current);
      const next = desired.get(path);
      if (!next && current) removes.push({ path: destination, expectedRevision: current.revision });
      else if (next && next.revision !== current?.revision) writes.push({ path: destination, bytes: next.bytes, ...(current ? { expectedRevision: current.revision } : {}) });
    }
    const result = await context.environment.commit({ guards: [{ path: 'bin', expectedRevision: installed.revision }], writes, removes }, { operation: 'apply', previous });
    return { installedVersion: installed.version, releaseVersion: version, checksum: release.checksum, downloaded: true, changed: writes.length + removes.length > 0,
      dryRun: result.dryRun, changes: result.changes, revision: result.dryRun ? installed.revision : (await context.environment.files.stat('bin')).revision,
      restartRequired: !result.dryRun && writes.length + removes.length > 0 };
  }
}
