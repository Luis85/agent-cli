import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import metadata from '../../package.json';
import { releaseFixture } from '../support/release.ts';

const execute = promisify(execFile);
const roots: string[] = [];
let assets: string;
let releaseRoot: string;
const archiveName = `forge-${metadata.version}.tar.gz`;
beforeAll(async () => {
  const fixture = await releaseFixture();
  assets = fixture.assets;
  releaseRoot = fixture.root;
}, 60_000);
afterAll(async () => { if (releaseRoot) await rm(releaseRoot, { recursive: true, force: true, maxRetries: 10 }); });
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 10 }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'forge-install-'));
  roots.push(root);
  return { root, workspace: join(root, 'workspace with spaces') };
}
const install = (workspace: string, from = assets) => execute(process.execPath,
  [join(assets, 'install-forge.mjs'), '--version', metadata.version, '--workspace', workspace, '--assets', from], { timeout: 60_000 });

describe('agent release installation', () => {
  it('installs without source dependencies, creates a project, generates code and serves the admin view', async () => {
    const result = await execute(process.execPath, [resolve('scripts/release-smoke.mjs'), assets, metadata.version], { timeout: 60_000 });
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, version: metadata.version, installation: true, project: true, generation: true, admin: true });
  }, 90_000);

  it('preserves repository files and refuses to replace the installed app', async () => {
    const { workspace } = await fixture();
    await mkdir(workspace);
    await writeFile(join(workspace, 'AGENTS.md'), '# Existing repository guidance\n');
    await writeFile(join(workspace, 'package.json'), '{"type":"module"}\n');
    expect(JSON.parse((await install(workspace)).stdout)).toMatchObject({ ok: true, version: metadata.version });
    expect(await readFile(join(workspace, 'AGENTS.md'), 'utf8')).toBe('# Existing repository guidance\n');
    expect(await readFile(join(workspace, 'package.json'), 'utf8')).toBe('{"type":"module"}\n');
    const config = await readFile(join(workspace, 'bin/config.json'));
    await expect(install(workspace)).rejects.toMatchObject({ stderr: expect.stringContaining('already has bin/') });
    expect(await readFile(join(workspace, 'bin/config.json'))).toEqual(config);
  }, 60_000);

  it('rejects a damaged download before installing app files', async () => {
    const { workspace, root } = await fixture();
    const damaged = join(root, 'assets');
    await mkdir(damaged);
    await writeFile(join(damaged, archiveName), 'corrupted bytes');
    await copyFile(join(assets, `${archiveName}.sha256`), join(damaged, `${archiveName}.sha256`));
    await expect(install(workspace, damaged)).rejects.toMatchObject({ stderr: expect.stringContaining('checksum verification failed') });
    await expect(readFile(join(workspace, 'bin/forge.js'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a checksummed archive with traversal paths before extraction', async () => {
    const { workspace, root } = await fixture();
    const malformed = join(root, 'assets');
    await mkdir(malformed);
    const header = Buffer.alloc(512);
    header.write('../escape');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write('00000000000\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header[156] = 48;
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    const archive = gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
    await writeFile(join(malformed, archiveName), archive);
    await writeFile(join(malformed, `${archiveName}.sha256`), `${createHash('sha256').update(archive).digest('hex')}  ${archiveName}\n`);
    await expect(install(workspace, malformed)).rejects.toMatchObject({ stderr: expect.stringContaining('unsafe path') });
    await expect(readFile(join(root, 'escape'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(workspace, 'bin/forge.js'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
