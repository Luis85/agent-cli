import { committedEvents } from '../support/events.ts';
import { beforeAll, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
let project: string;
beforeAll(() => { project = fixture.project; });

it('discovers commands, help and global options from any working directory', () => {
    const { status, body } = cli(['schema']);
    expect(status).toBe(0); expect(body.ok).toBe(true); expect(body.data.name).toBe('The Forge');
    expect(body.data.commands.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['make', 'setup', 'config', 'project', 'templates']));
    expect(cli(['make', '--help']).body.data.usage).toContain('generator');
    expect(cli(['--version']).body.data.version).toBe('0.1.0');
  });

it('rejects unknown commands/options and missing values with machine-readable errors', () => {
    for (const args of [['nonsense'], ['init'], ['--plugins', 'plugins.json', 'help'], ['read', 'a.md', '--typo'], ['write', 'a.md', '--content'], ['read'], ['read', 'a.md', '--json']]) {
      const result = cli(args); expect(result.status).not.toBe(0); expect(result.body.ok).toBe(false); expect(result.body.error.code).toBeTypeOf('string');
    }
    expect(cli(['read', 'missing.md']).status).toBe(3);
  });

it.each([
    ['UNKNOWN_OPTION', 'make', '--out', 'ignored'],
    ['UNKNOWN_OPTION', 'make', '--template', 'entity.md'],
    ['UNKNOWN_OPTION', 'make', '--values', '{}'],
    ['UNKNOWN_OPTION', 'make', '--values-from', 'inputs.json'],
    ['UNKNOWN_OPTION', 'make', '--date', '2026-10-07'],
    ['UNKNOWN_OPTION', 'make', 'entity', 'Order', '--template', 'entity.md'],
    ['UNKNOWN_OPTION', 'make', 'plugin', 'quality', '--out', 'elsewhere'],
    ['UNKNOWN_OPTION', 'make', '--framework', 'react', 'ui', 'button'],
    ['UNKNOWN_GENERATOR', 'make', 'missing', 'Order', '--template', 'entity.md'],
    ['UNKNOWN_GENERATOR', 'make', 'missing', 'Order', '--out'],
    ['INVALID_ARGUMENT', 'skills', '--out', 'ignored'],
    ['INVALID_ARGUMENT', 'skills', 'list', '--out', 'ignored'],
    ['INVALID_ARGUMENT', 'skills', 'show', 'forge-workflow', '--out', 'ignored'],
  ])('rejects inapplicable generation or installation options with %s: %j', (code, ...args) => {
    const result = cli(args);
    expect(result.status).toBe(2);
    expect(result.body.error.code).toBe(code);
    expect(committedEvents(result.body.events)).toEqual([]);
  });

it('treats flag-shaped command values as literal data without overriding configured dry runs or routing', async () => {
    const isolated = join(project, 'literal-values-workspace');
    await mkdir(join(isolated, 'bin'), { recursive: true });
    const config = join(isolated, 'bin/config.json');
    await writeFile(config, JSON.stringify({ settings: { dryRun: true } }));
    const args: string[] = [];
    const invocation = { root: isolated };
    for (const literal of ['--no-dry-run', '--root', '--config', '--version', '--no-plugins', '--help', '--json']) {
      const result = cli([...args, 'create', 'preview.md', '--content', literal], undefined, invocation);
      expect(result.status, literal).toBe(0);
      expect(result.body.data.dryRun, literal).toBe(true);
      expect(result.body.data.changes[0]).toMatchObject({ path: 'preview.md', bytes: Buffer.byteLength(literal), revision: createHash('sha256').update(literal).digest('hex') });
      expect(committedEvents(result.body.events), literal).toEqual([]);
      expect(await readdir(isolated)).toEqual(['bin']);
    }
    const committed = cli([...args, 'create', 'literal.md', '--content', '--version', '--no-dry-run'], undefined, invocation);
    expect(committed.status).toBe(0); expect(committed.body.data.dryRun).toBe(false);
    expect(committedEvents(committed.body.events)).toHaveLength(1);
    expect(await readFile(join(isolated, 'literal.md'), 'utf8')).toBe('--version');
    const lateRouting = cli([...args, 'create', 'late-routing.md', '--content', 'text', '--no-dry-run', '--root', project], undefined, invocation);
    expect(lateRouting.status).not.toBe(0); expect(lateRouting.body.events).toEqual([]);
    await expect(readFile(join(isolated, 'late-routing.md'))).rejects.toThrow();
    await expect(readFile(join(project, 'late-routing.md'))).rejects.toThrow();
  });
