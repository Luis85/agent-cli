import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { githubReleases, type ReleaseTool } from '../../src/plugins/updates/infrastructure/github.ts';
import policy from '../../configs/distribution-policy.json';
import metadata from '../../package.json';

const execute = promisify(execFile);
beforeAll(async () => { await execute(process.execPath, ['scripts/release.mjs'], { timeout: 30_000 }); }, 60_000);
function transport(corrupt = false, latest = `https://github.com/Luis85/agent-cli/releases/tag/v${metadata.version}`): ReleaseTool {
  return async (file, args, options) => {
    if (file !== 'curl') {
      const { stdout } = await execute(file, args, { ...options, encoding: 'utf8' });
      return { stdout };
    }
    expect(args).toContain('=https');
    expect(args).toContain('--max-filesize');
    if (args.includes('--write-out')) return { stdout: latest };
    const destination = args[args.indexOf('--output') + 1]!;
    const name = basename(destination);
    expect(args).toContain(`https://github.com/Luis85/agent-cli/releases/download/v${metadata.version}/${name}`);
    const bytes = corrupt && name.endsWith('.tar.gz') ? Buffer.from('bad archive') : await readFile(join('release', name));
    await writeFile(destination, bytes);
    return { stdout: '' };
  };
}

describe('GitHub release transport and extraction', () => {
  it('loads the exact checksummed app assets with real tar and executable version verification', async () => {
    const source = githubReleases(policy, transport());
    expect(await source.latest()).toBe(metadata.version);
    const release = await source.download(metadata.version);
    expect(release.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(release.files.map(file => file.path)).toEqual(expect.arrayContaining(policy.requiredAssets));
    expect(release.files.some(file => file.path === 'config.json' || file.path === 'data/context.json')).toBe(false);
  }, 60_000);
  it('rejects corrupted downloads before extraction', async () => {
    await expect(githubReleases(policy, transport(true)).download(metadata.version)).rejects.toMatchObject({ code: 'UPDATE_INVALID', message: expect.stringContaining('checksum') });
  });
  it('rejects redirected release discovery outside the official stable release path', async () => {
    await expect(githubReleases(policy, transport(false, 'https://other.example/releases/tag/v99.0.0')).latest()).rejects.toMatchObject({ code: 'UPDATE_INVALID' });
  });
  it('sanitizes failed tool and network diagnostics', async () => {
    const source = githubReleases(policy, async () => { throw new Error('https://private.example/?credential=secret'); });
    await expect(source.latest()).rejects.toMatchObject({ code: 'UPDATE_DOWNLOAD_FAILED', message: expect.not.stringContaining('secret') });
    await expect(source.download(metadata.version)).rejects.toMatchObject({ code: 'UPDATE_DOWNLOAD_FAILED', message: expect.not.stringContaining('secret') });
  });
});
