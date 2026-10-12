import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { devNull, tmpdir } from 'node:os';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReleaseSource } from '../application/update.ts';
import { distributionFiles, releaseVersion, requireUpdate, updateError, type DistributionPolicy } from '../domain/release.ts';
import { AppError } from '../../../domain/shared/errors.ts';

const execute = promisify(execFile);
export type ReleaseTool = (file: string, args: string[], options: { timeout?: number; maxBuffer?: number; cwd?: string }) => Promise<{ stdout: string }>;
const runTool: ReleaseTool = async (file, args, options) => {
  const { stdout } = await execute(file, args, { ...options, encoding: 'utf8' });
  return { stdout };
};
const base = 'https://github.com/Luis85/agent-cli/releases';
const curl = ['--fail', '--location', '--silent', '--show-error', '--proto', '=https', '--max-time', '180', '--max-filesize', '67108864'];
export function githubReleases(policy: DistributionPolicy, run: ReleaseTool = runTool): ReleaseSource {
  return {
    async latest() {
      try {
        const { stdout } = await run('curl', [...curl, `${base}/latest`, '--output', devNull, '--write-out', '%{url_effective}'], { timeout: 190_000 });
        const version = /^https:\/\/github\.com\/Luis85\/agent-cli\/releases\/tag\/v(\d+\.\d+\.\d+)$/.exec(stdout)?.[1];
        requireUpdate(version, 'GitHub did not return a stable Forge release.');
        return releaseVersion(version);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw updateError('UPDATE_DOWNLOAD_FAILED', 'Could not check GitHub Releases. Check network access and curl, then retry.');
      }
    },
    async download(version) {
      releaseVersion(version);
      const staging = await mkdtemp(join(tmpdir(), 'forge-update-'));
      try {
        const name = `forge-${version}.tar.gz`, archive = join(staging, name);
        for (const filename of [name, `${name}.sha256`]) await run('curl', [...curl, `${base}/download/v${version}/${filename}`, '--output', join(staging, filename)], { timeout: 190_000 });
        const bytes = await readFile(archive), checksum = createHash('sha256').update(bytes).digest('hex');
        requireUpdate((await readFile(`${archive}.sha256`, 'utf8')).trim() === `${checksum}  ${name}`, 'Release checksum verification failed; no app files were changed.');
        const { stdout: listing } = await run('tar', ['-tzf', name], { cwd: staging, maxBuffer: 8 * 1024 * 1024 });
        requireUpdate(listing.trim().split(/\r?\n/).every(path => path.startsWith('bin/') && !path.includes('\\') && !path.includes(':') && !path.split('/').some(part => part === '.' || part === '..')), 'Release archive contains an unsafe path.');
        const { stdout: detailed } = await run('tar', ['-tvzf', name], { cwd: staging, maxBuffer: 8 * 1024 * 1024 });
        requireUpdate(detailed.trim().split(/\r?\n/).every(line => ['-', 'd'].includes(line[0]!)), 'Release archive contains a link or special file.');
        await run('tar', ['-xzf', name, '--no-same-owner', '--no-same-permissions'], { cwd: staging });
        const root = join(staging, 'bin');
        const pkg: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        requireUpdate(pkg !== null && typeof pkg === 'object' && 'name' in pkg && pkg.name === 'forge-bundle' && 'version' in pkg && pkg.version === version, 'Release package version differs from the requested version.');
        const { stdout } = await run(process.execPath, [join(root, 'forge.js'), '--version'], { timeout: 30_000 });
        requireUpdate(JSON.parse(stdout).data?.version === version, 'The downloaded app cannot execute on this Node version.');
        const paths = distributionFiles(JSON.parse(await readFile(join(root, 'data/distribution.json'), 'utf8')), policy);
        const files = [];
        for (const path of paths) {
          const entry = await lstat(join(root, path));
          requireUpdate(entry.isFile() && !entry.isSymbolicLink(), 'A release asset is not a regular file.');
          const bytes = await readFile(join(root, path));
          files.push({ path, bytes, revision: createHash('sha256').update(bytes).digest('hex') });
        }
        return { version, checksum, files };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw updateError('UPDATE_DOWNLOAD_FAILED', 'Could not download or unpack the release. Check network access, curl, tar and available disk space; existing app files were preserved.');
      } finally { await rm(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    },
  };
}
