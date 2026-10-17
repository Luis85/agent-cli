import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;

describe('path forms agents pass', () => {
  it('accepts ./, backslash separators and absolute paths inside the root and reports the relative POSIX path', async () => {
    const created = await cli(['create', './specs/plan.md', '--content', '# Plan\n']);
    expect(created.status).toBe(0);
    expect(created.body.data.changes[0]).toMatchObject({ path: 'specs/plan.md', operation: 'created' });
    for (const path of ['specs\\plan.md', '.\\specs\\plan.md', join(fixture.project, 'specs', 'plan.md'), `${fixture.project}/specs/plan.md`]) {
      const read = await cli(['read', path]);
      expect(read.status, path).toBe(0);
      expect(read.body.data.path, path).toBe('specs/plan.md');
    }
    const { revision } = (await cli(['stat', join(fixture.project, 'specs/plan.md')])).body.data;
    const moved = await cli(['move', './specs/plan.md', 'specs\\roadmap.md', '--if-match', revision]);
    expect(moved.body.data).toMatchObject({ from: 'specs/plan.md', to: 'specs/roadmap.md' });
    const copied = await cli(['create', 'copy.md', '--from', join(fixture.project, 'specs', 'roadmap.md')]);
    expect(copied.status).toBe(0);
    expect(await readFile(join(fixture.project, 'copy.md'), 'utf8')).toBe('# Plan\n');
  });

  it('still refuses traversal and paths outside the root, naming the argument and a suggestion', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'forge-outside-'));
    try {
      await writeFile(join(outside, 'plan.md'), 'outside');
      const from = await cli(['create', 'stolen.md', '--from', join(outside, 'plan.md')]);
      expect(from.status).toBe(2);
      expect(from.body.error).toMatchObject({ code: 'INVALID_PATH', message: expect.stringContaining('--stdin'), details: { option: 'from', value: join(outside, 'plan.md'), suggestion: '--stdin' } });
      const read = await cli(['read', join(outside, 'plan.md')]);
      expect(read.body.error).toMatchObject({ code: 'INVALID_PATH', details: { argument: 'path', value: join(outside, 'plan.md') } });
      expect((await cli(['read', '../plan.md'])).body.error).toMatchObject({ code: 'INVALID_PATH', details: { argument: 'path' } });
      expect((await cli(['read', 'specs/../copy.md'])).body.error).toMatchObject({ code: 'INVALID_PATH', details: { argument: 'path', suggestion: 'copy.md' } });
      expect((await cli(['create', '.\\.git\\config', '--content', 'x'])).body.error).toMatchObject({ code: 'INVALID_PATH', details: { argument: 'path', value: '.\\.git\\config' } });
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  // Creating symlinks needs extra privileges on Windows.
  it.skipIf(process.platform === 'win32')('refuses symlinked components and other spellings of the root in absolute paths', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'forge-alias-'));
    try {
      await writeFile(join(outside, 'secret.md'), 'secret');
      await symlink(outside, join(fixture.project, 'linked'));
      await symlink(fixture.project, join(outside, 'root-alias'));
      expect((await cli(['read', join(fixture.project, 'linked', 'secret.md')])).body.error).toMatchObject({ code: 'UNSAFE_PATH' });
      expect((await cli(['read', './linked/secret.md'])).body.error).toMatchObject({ code: 'UNSAFE_PATH' });
      expect((await cli(['read', join(outside, 'root-alias', 'copy.md')])).body.error).toMatchObject({ code: 'INVALID_PATH', details: { argument: 'path' } });
    } finally {
      await rm(join(fixture.project, 'linked'), { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('input bytes from other platforms', () => {
  it('applies a plan and reads --edits whose JSON starts with a UTF-8 byte order mark', async () => {
    await writeFile(join(fixture.project, 'plan.json'), `﻿${JSON.stringify({ version: 1, operations: [{ op: 'write', path: 'bom.md', content: 'one two\n' }] })}`);
    expect((await cli(['apply', 'plan.json'])).status).toBe(0);
    await writeFile(join(fixture.project, 'edits.json'), `﻿${JSON.stringify([{ find: 'one', replace: '1' }])}`);
    const { revision } = (await cli(['read', 'bom.md'])).body.data;
    expect((await cli(['edit', 'bom.md', '--edits', '@edits.json', '--if-match', revision])).status).toBe(0);
    expect(await readFile(join(fixture.project, 'bom.md'), 'utf8')).toBe('1 two\n');
  });

  it('writes wrapped base64 from standard input and from a plan like the unwrapped text', async () => {
    const bytes = Buffer.from(Array.from({ length: 300 }, (_, index) => (index * 7) % 256));
    const wrapped = `${bytes.toString('base64').match(/.{1,76}/g)!.join('\n')}\n`;
    expect((await cli(['create', 'blob.png', '--stdin', '--encoding', 'base64'], wrapped)).status).toBe(0);
    expect(await readFile(join(fixture.project, 'blob.png'))).toEqual(bytes);
    const plan = { version: 1, operations: [{ op: 'write', path: 'plan.png', content: wrapped.replaceAll('\n', '\r\n'), encoding: 'base64' }] };
    expect((await cli(['apply', '-'], JSON.stringify(plan))).status).toBe(0);
    expect(await readFile(join(fixture.project, 'plan.png'))).toEqual(bytes);
  });
});
