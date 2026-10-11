import { expect, it } from 'vitest';
import { symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { uiFrameworks } from '../../src/plugins/ui/domain/components/definition.ts';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
const execute = promisify(execFile);

it('generates every UI target by default where the generated project\'s own static checks pass', async () => {
  for (const args of [['project', 'create', 'demo'], ['project', 'open', 'demo'], ['components', 'init']]) expect((await cli(args)).status, args.join(' ')).toBe(0);
  for (const framework of uiFrameworks) {
    // Each framework gets its own folder, so targets that share file names (html, htmx, vanilla) never collide.
    const result = await cli(['make', 'ui', 'card', '--framework', framework, '--stories']);
    expect(result.status, framework).toBe(0);
    const paths: string[] = result.body.data.changes.map((change: { path: string }) => change.path);
    expect(paths.filter(path => !path.startsWith(`projects/demo/ui/${framework}/components/`) && !path.startsWith(`projects/demo/ui/${framework}/stories/`)), framework).toEqual([]);
  }
  // Use the Forge toolchain; no dependency install or network access. The checks run as the project's scripts do.
  const project = join(fixture.project, 'projects/demo');
  await symlink(resolve('node_modules'), join(project, 'node_modules'), 'junction');
  for (const check of ['structure', 'lint', 'typecheck', 'analyze']) {
    await execute(process.execPath, [`scripts/quality/${check}.mjs`], { cwd: project, timeout: 45_000, maxBuffer: 4 * 1024 * 1024 })
      .catch((error: Error & { stdout?: string }) => { throw new Error(`${check} failed: ${error.message}\n${error.stdout ?? ''}`); });
  }
}, 120_000);
