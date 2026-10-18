import { describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { writeVault } from '../support/vault.ts';

const fixture = portableCli();
type Response = Awaited<ReturnType<typeof fixture.cli>>;
const ids = (response: Response) => (response.body.events as Array<{ id: string }>).map(event => event.id);

async function vault(name: string, files: Record<string, string> = {}) {
  const root = join(fixture.project, name);
  await mkdir(root, { recursive: true });
  await writeVault(root, files);
  const cli = (args: string[], input?: string) => fixture.cli(args, input, { root });
  const revision = async (path: string) => (await cli(['read', path])).body.data.revision as string;
  const text = (path: string) => readFile(join(root, path), 'utf8');
  return { root, cli, revision, text };
}

describe('retried mutations through the portable CLI', () => {
  it('reports a retried create or write of the same bytes as unchanged and refuses other content per case', async () => {
    const { cli, revision } = await vault('writes');
    expect((await cli(['create', 'notes/a.md', '--content', '# A\n'])).body.data.changes[0].operation).toBe('created');
    const before = await revision('notes/a.md');
    const retry = await cli(['create', 'notes/a.md', '--content', '# A\n']);
    expect(retry.body.data.changes).toEqual([{ path: 'notes/a.md', revision: before, operation: 'unchanged', bytes: 4, alreadyApplied: true }]);
    // The operation summary of an unchanged write is a valid host event, so no payload warning appears.
    expect(retry.body.warnings).toEqual([]);
    expect(ids(retry)).toEqual([]);
    const exists = await cli(['create', 'notes/a.md', '--content', '# B\n']);
    expect(exists.body.error).toMatchObject({ code: 'CONFLICT', message: 'File already exists: notes/a.md. Replace it with write --if-match and its currentRevision, or change it with edit.', details: { expectedRevision: null, currentRevision: before } });
    expect(exists.body.error.hint).not.toContain('create only adds new paths');
    expect((await cli(['write', 'notes/a.md', '--content', '# B\n', '--if-match', before])).body.ok).toBe(true);
    // The same write retried with the revision it replaced finds its own result.
    expect((await cli(['write', 'notes/a.md', '--content', '# B\n', '--if-match', before])).body.data.changes[0]).toMatchObject({ operation: 'unchanged', alreadyApplied: true });
    const stale = await cli(['write', 'notes/a.md', '--content', '# C\n', '--if-match', before]);
    expect(stale.body.error.message).toBe('File changed since it was read: notes/a.md. Read it again, reapply the change to the current content and retry with its currentRevision.');
    const gone = await cli(['write', 'notes/missing.md', '--content', 'x', '--if-match', before]);
    expect(gone.body.error).toMatchObject({ code: 'CONFLICT', details: { path: 'notes/missing.md', currentRevision: null } });
    expect(gone.body.error.message).toContain('omit --if-match to create it');
  });

  it('writes nothing for no-op edits and marks a stale retry whose change is present', async () => {
    const { cli, revision, text } = await vault('edits', { 'Plan.md': '---\nstatus: draft\ntags: [a,  b]\n---\n# Plan\n' });
    const original = await revision('Plan.md');
    const noop = await cli(['properties', 'Plan.md', '--set', '{"status":"draft"}', '--if-match', original]);
    expect(noop.body.data.changes).toEqual([expect.objectContaining({ operation: 'unchanged' })]);
    expect(noop.body.data.changes[0].alreadyApplied).toBeUndefined();
    expect(ids(noop)).toEqual([]);
    expect(ids(await cli(['edit', 'Plan.md', '--find', 'Plan', '--replace', 'Plan', '--if-match', original]))).toEqual([]);
    const set = await cli(['properties', 'Plan.md', '--set', '{"status":"done"}', '--if-match', original]);
    expect(ids(set)).toEqual(['vault.modify']);
    expect(await text('Plan.md')).toBe('---\nstatus: done\ntags: [a,  b]\n---\n# Plan\n');
    const retry = await cli(['properties', 'Plan.md', '--set', '{"status":"done"}', '--if-match', original]);
    expect(retry.body.error).toMatchObject({ code: 'CONFLICT', details: { alreadyApplied: true, expectedRevision: original, currentRevision: await revision('Plan.md') } });
    const append = await cli(['edit', 'Plan.md', '--append', '--content', 'x', '--if-match', original]);
    expect(append.body.error.code).toBe('CONFLICT');
    expect(append.body.error.details.alreadyApplied).toBeUndefined();
  });

  it('removes properties with --unset and keeps null as YAML null', async () => {
    const { cli, revision, text } = await vault('unset', { 'Note.md': '---\nowner: me\ndraft: true\nkeep: [x, y]\n---\nBody\n' });
    expect((await cli(['properties', 'Note.md', '--unset', 'draft, owner', '--set', '{"reviewer":null}', '--if-match', await revision('Note.md')])).body.ok).toBe(true);
    expect(await text('Note.md')).toBe('---\nkeep: [x, y]\nreviewer: null\n---\nBody\n');
    expect((await cli(['properties', 'Note.md', '--if-match', await revision('Note.md')])).body.error.code).toBe('INVALID_INPUT');
    expect((await cli(['properties', 'Note.md', '--set', '{"keep":1}', '--unset', 'keep', '--if-match', await revision('Note.md')])).body.error.code).toBe('INVALID_INPUT');
    await writeFile(join(fixture.project, 'unset/Plain.md'), 'Plain\n');
    expect((await cli(['properties', 'Plain.md', '--set', '{"status":"draft","tags":["a","b"]}', '--if-match', await revision('Plain.md')])).body.ok).toBe(true);
    expect(await text('Plain.md')).toBe('---\nstatus: draft\ntags:\n  - a\n  - b\n---\nPlain\n');
  });

  it('reports a retried move or rename as already applied and a retried delete as already deleted', async () => {
    const { cli, revision } = await vault('moves', { 'a.md': 'A\n', 'b.md': 'B\n', 'c.md': 'C\n' });
    const a = await revision('a.md'), b = await revision('b.md'), c = await revision('c.md');
    expect((await cli(['move', 'a.md', 'x/a.md', '--if-match', a])).body.ok).toBe(true);
    const moved = await cli(['move', 'a.md', 'x/a.md', '--if-match', a]);
    expect(moved.body.data).toMatchObject({ from: 'a.md', to: 'x/a.md', revision: a, renames: [], changes: [], alreadyApplied: true });
    expect(ids(moved)).toEqual([]);
    expect((await cli(['move', 'a.md', 'x/a.md', '--if-match', b])).body.error).toMatchObject({ code: 'NOT_FOUND', message: 'File or folder not found: a.md', details: { path: 'a.md' } });
    expect((await cli(['rename', 'b.md', 'renamed', '--if-match', b])).body.data.to).toBe('renamed.md');
    expect((await cli(['rename', 'b.md', 'renamed', '--if-match', b])).body.data).toMatchObject({ to: 'renamed.md', alreadyApplied: true });
    expect((await cli(['delete', 'c.md', '--if-match', c])).body.data.trashPath).toBe('.trash/c.md');
    expect((await cli(['delete', 'c.md', '--if-match', c])).body.error).toMatchObject({ code: 'NOT_FOUND', details: { path: 'c.md', alreadyDeleted: true, trashPath: '.trash/c.md' } });
    expect((await cli(['delete', 'c.md', '--if-match', a])).body.error.details).toEqual({ path: 'c.md' });
  });

  it('refuses an empty revision as no guard, in English and German, and writes nothing', async () => {
    const { cli, revision, text } = await vault('unguarded', { 'a.md': 'A\n' });
    const current = await revision('a.md');
    const english = 'No revision guards a.md: pass its currentRevision as --if-match (ifMatch in an apply plan) to change or delete it.';
    const german = `Keine Revision schützt a.md: Übergeben Sie die aktuelle Revision ${current} mit --if-match (ifMatch in einem apply-Plan), um die Datei zu ändern oder zu löschen.`;
    for (const [args, message] of [
      [['delete', 'a.md'], english], [['delete', 'a.md', '--permanent'], 'Removing a file requires its current --if-match revision: a.md'],
      [['move', 'a.md', 'b.md'], english], [['write', 'a.md', '--content', 'B\n'], english],
    ] as const) {
      const failed = await cli([...args, '--if-match=']);
      expect(failed.body.error, args.join(' ')).toMatchObject({ code: 'CONFLICT', message, hint: expect.stringMatching(/^The request named error\.details\.path with an empty revision/), details: { path: 'a.md', expectedRevision: '', currentRevision: current, reason: 'revision-required' } });
      const localized = await cli(['--lang', 'de', ...args, '--if-match=']);
      expect(localized.body.error, args.join(' ')).toMatchObject({ code: 'CONFLICT', message: german, hint: expect.stringMatching(/^Die Anfrage nannte error\.details\.path mit einer leeren Revision/), details: { reason: 'revision-required' } });
    }
    expect(await text('a.md')).toBe('A\n');
  });

  it('moves into a folder named with a trailing slash or that exists, and warns when an extension is dropped', async () => {
    const { root, cli, revision } = await vault('into', { 'a.md': 'A\n', 'b.md': 'B\n', 'c.md': 'C\n', 'archive/old.md': 'Old\n' });
    expect((await cli(['move', 'a.md', 'new/', '--if-match', await revision('a.md')])).body.data.to).toBe('new/a.md');
    expect((await cli(['move', 'b.md', 'archive', '--if-match', await revision('b.md')])).body.data.to).toBe('archive/b.md');
    const dropped = await cli(['move', 'c.md', 'plain', '--if-match', await revision('c.md')]);
    expect(dropped.body.data.to).toBe('plain');
    expect(dropped.body.warnings).toEqual([{ code: 'EXTENSION_DROPPED', message: expect.stringMatching(/^plain has no extension, so moving c\.md drops \.md\./), details: { from: 'c.md', to: 'plain', extension: '.md' } }]);
    expect((await readdir(root)).filter(name => name !== '.forge').sort()).toEqual(['archive', 'new', 'plain']);
    // A move inside an apply plan warns the same way, once the plan commits.
    const plan = JSON.stringify({ version: 1, operations: [{ op: 'move', from: 'archive/old.md', to: 'archive/older', ifMatch: await revision('archive/old.md') }] });
    const applied = await cli(['apply', '-'], plan);
    expect(applied.body.ok).toBe(true);
    expect(applied.body.warnings).toEqual([{ code: 'EXTENSION_DROPPED', message: expect.stringContaining('moving archive/old.md drops .md'), details: { from: 'archive/old.md', to: 'archive/older', extension: '.md' } }]);
    expect((await readdir(join(root, 'archive'))).sort()).toEqual(['b.md', 'older']);
  });

  it('warns about a literal \\n escape and an empty --stdin', async () => {
    const { cli, revision, text } = await vault('warnings');
    const literal = await cli(['create', 'one.md', '--content', 'a\\nb']);
    expect(literal.body.warnings).toEqual([{ code: 'LITERAL_NEWLINE', message: expect.stringMatching(/^--content contains the two characters \\n but no line break/), details: { option: 'content' } }]);
    expect(await text('one.md')).toBe('a\\nb');
    expect((await cli(['create', 'two.md', '--content', 'a\nb'])).body.warnings).toEqual([]);
    expect((await cli(['edit', 'two.md', '--find', 'b', '--replace', 'c\\nd', '--if-match', await revision('two.md')])).body.warnings).toHaveLength(1);
    const empty = await cli(['write', 'three.md', '--stdin'], '');
    expect(empty.body.warnings).toEqual([{ code: 'EMPTY_STDIN', message: expect.stringMatching(/^--stdin read no bytes, so three\.md is written empty\./), details: { path: 'three.md' } }]);
    expect((await cli(['--lang', 'de', 'create', 'four.md', '--content', 'x\\ny'])).body.warnings).toEqual([{ code: 'LITERAL_NEWLINE', message: expect.stringMatching(/^--content enthält/), details: { option: 'content' } }]);
  });

  it('reads notes whose frontmatter or encoding a strict parse refuses', async () => {
    const { root, cli } = await vault('reads', { 'bad.md': '---\ntitle: [unclosed\n---\nBody\n', 'open.md': '---\ntitle: x\nBody\n' });
    await writeFile(join(root, 'latin1.md'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    const bad = await cli(['read', 'bad.md']);
    expect(bad.body.data.document).toMatchObject({ kind: 'markdown', content: '---\ntitle: [unclosed\n---\nBody\n', properties: null, issue: { code: 'INVALID_YAML' } });
    expect((await cli(['read', 'bad.md', '--parts', 'body'])).body.data.document.body).toBe('Body\n');
    expect((await cli(['read', 'open.md'])).body.data.document).toMatchObject({ properties: null, issue: { code: 'INVALID_FRONTMATTER', message: 'Unclosed YAML frontmatter.' } });
    expect((await cli(['read', 'latin1.md'])).body.data.document).toEqual({ kind: 'attachment', encoding: 'base64', content: 'Y2Fm6Qo=' });
    expect((await cli(['validate', 'bad.md'])).body.error.code).toBe('INVALID_YAML');
    const schema = (await cli(['schema', 'read'])).body.data.commands[0].errors as string[];
    expect(schema).toEqual(expect.arrayContaining(['NOT_FOUND', 'INVALID_CANVAS', 'INVALID_BASE', 'INVALID_YAML']));
  });

  it('requires apply ifMatch for existing paths, refuses the repeat and predicts the folders it creates', async () => {
    const { cli, revision } = await vault('apply', { 'notes/a.md': 'A\n' });
    const unguarded = await cli(['apply', '-'], JSON.stringify({ version: 1, operations: [{ op: 'move', from: 'notes/a.md', to: 'archive/2026/a.md' }] }));
    expect(unguarded.body.error).toMatchObject({ code: 'CONFLICT', details: { operation: 0, path: 'notes/a.md', expectedRevision: null, currentRevision: await revision('notes/a.md') } });
    const plan = JSON.stringify({ version: 1, operations: [{ op: 'move', from: 'notes/a.md', to: 'archive/2026/a.md', ifMatch: await revision('notes/a.md') }, { op: 'write', path: 'new/b.md', content: 'B\n' }] });
    const preview = await cli(['apply', '-', '--dry-run'], plan);
    expect(preview.body.data.folders).toEqual(['archive', 'archive/2026', 'new']);
    expect((await cli(['apply', '-'], plan)).body.data.folders).toEqual(preview.body.data.folders);
    expect((await cli(['apply', '-'], plan)).body.error).toMatchObject({ code: 'CONFLICT', details: { operation: 0 } });
  });

  it('names paths relative to the selected project in failures', async () => {
    const { cli, revision } = await vault('scoped');
    for (const args of [['project', 'create', 'demo'], ['project', 'open', 'demo'], ['create', 'notes/plan.md', '--content', 'Plan\n']]) expect((await cli(args)).status, args.join(' ')).toBe(0);
    const missing = await cli(['read', 'nope.md']);
    expect(missing.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'File not found: nope.md', details: { path: 'nope.md' } });
    const exists = await cli(['create', 'notes/plan.md', '--content', 'Other\n']);
    expect(exists.body.error).toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/^File already exists: notes\/plan\.md\./), details: { path: 'notes/plan.md' } });
    expect((await cli(['delete', 'nope.md', '--if-match', 'abc'])).body.error.details).toEqual({ path: 'nope.md' });
    expect((await cli(['move', 'notes/plan.md', 'moved.md', '--if-match', 'stale'])).body.error.details).toMatchObject({ path: 'notes/plan.md' });
    expect((await cli(['write', 'notes/plan.md', '--content', 'x', '--if-match', 'stale'])).body.error.details.path).toBe('notes/plan.md');
    expect((await cli(['edit', 'notes/plan.md', '--append', '--content', 'x', '--if-match', await revision('notes/plan.md'), '--dry-run'])).body.ok).toBe(true);
  });
});
