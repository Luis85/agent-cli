import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const { cli } = fixture;
const outsideWarning = (cwd: string, workspaceRoot: string) => ({ code: 'CWD_OUTSIDE_WORKSPACE', details: { cwd, workspaceRoot }, message: `The working directory ${cwd} is outside the workspace root ${workspaceRoot}; relative paths resolve against the workspace root (context.root), not the working directory. Pass --root or set FORGE_ROOT to use another workspace.` });

describe('value-taking options followed by a flag', () => {
  it('refuse an edit whose empty --replace would swallow --dry-run, so nothing is written', async () => {
    expect((await cli(['create', 'swallow.md', '--content', 'alpha beta'])).status).toBe(0);
    const { revision } = (await cli(['read', 'swallow.md'])).body.data;
    // edit f --find a --replace $EMPTY --dry-run --if-match R, with the shell dropping the empty unquoted variable.
    const result = await cli(['edit', 'swallow.md', '--find', 'alpha', '--replace', '--dry-run', '--if-match', revision]);
    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({ ok: false, error: { code: 'MISSING_ARGUMENT', details: { option: 'replace' }, message: expect.stringContaining('--replace=<value>') }, events: [] });
    expect(await readFile(join(fixture.project, 'swallow.md'), 'utf8')).toBe('alpha beta');
    // The inline form passes the literal value; the real --dry-run then previews without writing.
    const literal = await cli(['edit', 'swallow.md', '--find', 'alpha', '--replace=--dry-run', '--dry-run', '--if-match', revision]);
    expect(literal.status).toBe(0);
    expect(literal.body.data).toMatchObject({ dryRun: true, changes: [{ path: 'swallow.md', operation: 'updated' }] });
    expect(await readFile(join(fixture.project, 'swallow.md'), 'utf8')).toBe('alpha beta');
  });

  it('refuse to create a file whose content would be the --json flag', async () => {
    const result = await cli(['create', 'flag.md', '--content', '--json']);
    expect(result).toMatchObject({ status: 2, body: { error: { code: 'MISSING_ARGUMENT', details: { option: 'content' } } } });
    await expect(readFile(join(fixture.project, 'flag.md'))).rejects.toThrow();
  });
});

describe('response format of parse failures', () => {
  it.each([
    [['read', 'a.md', '--bogus', '--json'], 'UNKNOWN_OPTION'],
    [['bogus', '--json'], 'UNKNOWN_COMMAND'],
    [['write', 'a.md', '--content', '--json'], 'MISSING_ARGUMENT'],
    [['read', 'a.md', '--json', '--', '--no-json'], 'INVALID_ARGUMENT'],
  ])('is compact with --json after the command: %j', async (args, code) => {
    const result = await fixture.spawnCli(args);
    const body = JSON.parse(result.stdout);
    expect(body.error.code).toBe(code);
    expect(result.stdout).toBe(`${JSON.stringify(body)}\n`);
  });
});

describe('workspace root selection', () => {
  it('reads FORGE_ROOT without --root, lets --root win over it, and accepts --root after the command', async () => {
    const other = join(fixture.project, 'other-workspace');
    await mkdir(other, { recursive: true });
    const fromEnvironment = await cli(['config'], undefined, { root: null, env: { FORGE_ROOT: fixture.project } });
    expect(fromEnvironment.body).toMatchObject({ ok: true, context: { workspaceRoot: fixture.project }, warnings: [] });
    const flagWins = await cli(['config'], undefined, { root: other, env: { FORGE_ROOT: fixture.project } });
    expect(flagWins.body.context.workspaceRoot).toBe(other);
    const late = await cli(['config', '--root', other], undefined, { root: null, env: { FORGE_ROOT: undefined }, cwd: other });
    expect(late.body).toMatchObject({ ok: true, context: { workspaceRoot: other }, warnings: [] });
  });

  it('fails with INVALID_ROOT, exit 3, for a root that does not exist or is not a directory', async () => {
    await writeFile(join(fixture.project, 'plain-file'), 'text');
    for (const root of [join(fixture.project, 'missing-workspace'), join(fixture.project, 'plain-file')]) {
      const flag = await cli(['read', 'a.md'], undefined, { root, cwd: fixture.project });
      expect(flag.status).toBe(3);
      expect(flag.body).toMatchObject({ ok: false, error: { code: 'INVALID_ROOT', details: { root } }, events: [] });
      expect(flag.body).not.toHaveProperty('context');
      const environment = await cli(['read', 'a.md'], undefined, { root: null, env: { FORGE_ROOT: root }, cwd: fixture.project });
      expect(environment).toMatchObject({ status: 3, body: { error: { code: 'INVALID_ROOT' } } });
    }
  });

  it('warns when the working directory is outside the workspace root, never inside it', async () => {
    const inside = join(fixture.project, 'notes/deep');
    await mkdir(inside, { recursive: true });
    expect((await cli(['config'], undefined, { cwd: inside })).body.warnings).toEqual([]);
    const outside = await cli(['config'], undefined, { cwd: fixture.bundle });
    expect(outside.body).toMatchObject({ ok: true, warnings: [outsideWarning(fixture.bundle, fixture.project)] });
    // The default workspace is the one containing the distribution, whatever the working directory.
    const defaulted = await cli(['config'], undefined, { root: null, env: { FORGE_ROOT: undefined } });
    expect(defaulted.body).toMatchObject({ context: { workspaceRoot: fixture.bundle }, warnings: [outsideWarning(fixture.project, fixture.bundle)] });
    const german = await cli(['config', '--lang', 'de'], undefined, { cwd: fixture.bundle });
    expect(german.body.warnings).toEqual([expect.objectContaining({ code: 'CWD_OUTSIDE_WORKSPACE', message: expect.stringContaining(`Das Arbeitsverzeichnis ${fixture.bundle} liegt außerhalb`) })]);
  });
});

it('says where the revision of a missing --if-match comes from', async () => {
  expect((await cli(['create', 'guarded.md', '--content', 'text'])).status).toBe(0);
  const result = await cli(['properties', 'guarded.md', '--set', '{"a":1}']);
  expect(result.body.error).toMatchObject({ code: 'MISSING_ARGUMENT', details: { option: 'if-match' }, message: expect.stringContaining('data.revision from read or stat') });
});
