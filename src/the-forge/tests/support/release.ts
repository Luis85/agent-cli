import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import metadata from '../../package.json';
import { distribution } from './workspace.ts';

/** Package the read-only built app into private artifacts; parallel suites never share release output files. */
export async function releaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'forge-release-assets-'));
  try {
    for (const path of ['scripts/release.mjs', 'scripts/install-forge.mjs', 'configs/distribution-policy.json', `docs/releases/${metadata.version}.md`]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(resolve(path), join(root, path));
    }
    await writeFile(join(root, 'package.json'), JSON.stringify({ ...metadata, config: { ...metadata.config, distribution } }));
    await promisify(execFile)(process.execPath, ['scripts/release.mjs'], { cwd: root, timeout: 30_000 });
    return { root, assets: join(root, 'release') };
  } catch (error) {
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
    throw error;
  }
}
