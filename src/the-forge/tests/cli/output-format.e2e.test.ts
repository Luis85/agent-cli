import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();

// The shared harness deliberately adds --json; these cases exercise explicit formatting overrides instead.
function run(args: string[]) {
  return new Promise<{ status: string | number; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, [join(fixture.bundle, 'bin/forge.js'), '--root', fixture.project, ...args],
      { cwd: fixture.project, timeout: 30_000 }, (error, stdout, stderr) => {
        resolve({ status: error ? error.code ?? 'unknown' : 0, stdout, stderr });
      });
  });
}

it.each([
  [false, ['read', 'missing.md', '--parts', 'invalid', '--json'], 'INVALID_OPTION_VALUE'],
  [true, ['make', 'document', 'Plan', '--no-json'], 'MISSING_ARGUMENT'],
  [false, ['read', 'missing.md', '--events', 'invalid', '--json'], 'INVALID_OPTION_VALUE'],
  [true, ['read', 'missing.md', '--lang', 'invalid', '--no-json'], 'INVALID_LANGUAGE'],
] as const)('honors formatting overrides on validation failures (configured compact: %s, args: %j)', async (configured, args, code) => {
  await mkdir(join(fixture.project, 'bin'), { recursive: true });
  await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify({ settings: { json: configured } }));
  const result = await run([...args]);
  expect(result.status).toBe(2);
  expect(result.stderr).toBe('');
  const response = JSON.parse(result.stdout);
  expect(response).toMatchObject({ ok: false, error: { code }, events: [] });
  expect(result.stdout).toBe(JSON.stringify(response, null, configured ? 2 : undefined) + '\n');
});
