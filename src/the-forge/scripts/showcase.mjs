// Regenerate or drift-check the committed showcase project in <workspace>/src/forge-showcase.
// Run from src/the-forge; the workspace is the parent of package.json config.distribution.
//
//   node scripts/showcase.mjs             regenerate src/forge-showcase from scratch
//   node scripts/showcase.mjs --check     regenerate into a temporary workspace and report drift
//   node scripts/showcase.mjs --lockfile  regenerate, then refresh package-lock.json with npm (network)
//
// Generation always runs the workspace's bundled CLI (bin/forge.js) against a temporary
// workspace with a fixed configuration, so it never reads or changes the
// checkout's project selection, configuration or templates.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgeCli } from './showcase/cli.mjs';
import { buildAutomation, buildCode, buildProject } from './showcase/code.mjs';
import { buildDataSources } from './showcase/data.mjs';
import { buildDesignSystem } from './showcase/design-system.mjs';
import { project } from './showcase/project.mjs';
import { buildLog, buildLogPath, readme } from './showcase/readme.mjs';
import { configureToolchain } from './showcase/toolchain.mjs';
import { compareTrees, listFiles, lockfileProblems, treeSize } from './showcase/tree.mjs';
import { buildVault } from './showcase/vault.mjs';
import { exploreVault } from './showcase/vault-explore.mjs';

const lockfile = 'package-lock.json';
const forgeProject = resolve(fileURLToPath(new URL('..', import.meta.url)));
// The showcase is a sibling managed project in the workspace that receives Forge's bin directory.
const bin = resolve(forgeProject, JSON.parse(readFileSync(join(forgeProject, 'package.json'), 'utf8')).config.distribution);
const workspaceRoot = dirname(bin);
const target = join(workspaceRoot, 'src', 'forge-showcase');
const executable = join(bin, 'forge.js');

/** A generic workspace configuration: independent of local settings, with projects under src like this checkout. */
const workspaceConfig = { schemaVersion: 1, paths: { projects: 'src' }, settings: { language: 'en' } };

function options() {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => !['--check', '--lockfile'].includes(arg));
  if (unknown.length > 0 || (args.includes('--check') && args.includes('--lockfile'))) {
    throw new Error('Usage: node scripts/showcase.mjs [--check | --lockfile]');
  }
  return { check: args.includes('--check'), lockfile: args.includes('--lockfile') };
}

/** Build the complete showcase in a fresh workspace and return the generated project directory. @param {string} workspace */
async function generate(workspace) {
  if (!existsSync(executable)) throw new Error('The workspace bin/forge.js is missing; run npm run build in src/the-forge first');
  mkdirSync(join(workspace, 'bin'));
  writeFileSync(join(workspace, 'bin', 'config.json'), `${JSON.stringify(workspaceConfig, null, 2)}\n`);
  const cli = forgeCli(executable, workspace, project.directory);
  buildProject(cli);
  buildCode(cli);
  await buildDesignSystem(cli);
  buildDataSources(cli);
  const { queries } = await buildVault(cli);
  const exploration = await exploreVault(cli);
  buildAutomation(cli);
  configureToolchain(cli);
  cli.begin('Documentation');
  const log = [...cli.log];
  cli.create(buildLogPath, buildLog(log));
  cli.replace('README.md', readme(queries, exploration));
  assertContained(workspace);
  return join(workspace, project.directory);
}

/** Generation must not leave anything outside the project except the temporary workspace's own bin. @param {string} workspace */
function assertContained(workspace) {
  const stray = [
    ...readdirSync(workspace).filter(name => !['bin', 'src'].includes(name)),
    ...readdirSync(join(workspace, 'src')).filter(name => name !== 'forge-showcase').map(name => `src/${name}`),
  ];
  if (stray.length > 0) throw new Error(`Generation wrote outside ${project.directory}: ${stray.join(', ')}`);
}

/** Replace exactly src/forge-showcase with the generated tree, keeping the committed lockfile. @param {string} generated */
function install(generated) {
  if (target !== join(workspaceRoot, 'src', 'forge-showcase')) throw new Error(`Refusing to replace ${target}`);
  const lock = existsSync(join(target, lockfile)) ? readFileSync(join(target, lockfile)) : undefined;
  rmSync(target, { recursive: true, force: true });
  cpSync(generated, target, { recursive: true });
  if (lock) writeFileSync(join(target, lockfile), lock);
}

function refreshLockfile() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: target, stdio: ['ignore', 2, 2], shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`npm install --package-lock-only failed in ${project.directory}`);
}

/** @param {string} generated */
function drift(generated) {
  const differences = compareTrees(generated, target, [lockfile]);
  const lockPath = join(target, lockfile);
  const problems = existsSync(lockPath)
    ? lockfileProblems(readFileSync(join(generated, 'package.json'), 'utf8'), readFileSync(lockPath, 'utf8'))
    : [`${lockfile} is missing; run npm run showcase -- --lockfile`];
  return { differences, problems };
}

async function main() {
  const selected = options();
  const workspace = mkdtempSync(join(tmpdir(), 'forge-showcase-'));
  try {
    const generated = await generate(workspace);
    if (selected.check) {
      const { differences, problems } = drift(generated);
      const ok = differences.length === 0 && problems.length === 0;
      process.stdout.write(`${JSON.stringify({ ok, project: project.directory, differences, lockfile: problems, ...treeSize(generated) }, null, 2)}\n`);
      if (!ok) process.exitCode = 1;
      return;
    }
    install(generated);
    if (selected.lockfile) refreshLockfile();
    const files = listFiles(target);
    process.stdout.write(`${JSON.stringify({ ok: true, project: project.directory, lockfile: files.includes(lockfile), ...treeSize(target) }, null, 2)}\n`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

try { await main(); }
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
