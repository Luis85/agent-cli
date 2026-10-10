import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { applyUnifiedDiff } from '../support/unified-diff.ts';

const fixture = portableCli();
const cli = fixture.cli;
const ids = (events: Array<{ id: string }>) => events.map(event => event.id);
// Each workflow spawns several CLI processes; allow for slow shared CI hosts.
const workflowTimeout = 30000;

describe('lean agent responses', () => {
  it('reads Markdown without body duplication or lifecycle records unless requested', () => {
    expect(cli(['create', 'note.md', '--content', '---\nstatus: draft\n---\n# Note\n']).status).toBe(0);
    const lean = cli(['read', 'note.md']).body;
    expect(lean.data.document).toEqual({ kind: 'markdown', content: '---\nstatus: draft\n---\n# Note\n', properties: { status: 'draft' } });
    expect(lean.events).toEqual([]);
    expect(cli(['read', 'note.md', '--parts', 'body']).body.data.document.body).toBe('# Note\n');
    const invalid = cli(['read', 'note.md', '--parts', 'outline']);
    expect(invalid.status).toBe(2);
    expect(invalid.body.error.code).toBe('INVALID_ARGUMENT');
  }, workflowTimeout);

  it('selects envelope events with --events and settings.events', async () => {
    const created = cli(['write', 'src/x.ts', '--content', 'export const a = 1;\n']).body;
    expect(ids(created.events)).toEqual(['file.created']);
    const all = cli(['--events', 'all', 'write', 'src/y.ts', '--content', 'export const b = 2;\n']).body;
    expect(ids(all.events)).toEqual(expect.arrayContaining(['command.started', 'workspace.started', 'file.created', 'workspace.succeeded', 'command.succeeded']));
    expect(cli(['write', 'src/z.ts', '--content', 'z\n', '--events', 'none']).body.events).toEqual([]);
    const invalid = cli(['read', 'note.md', '--events', 'verbose']);
    expect(invalid.status).toBe(2);
    expect(invalid.body.error.code).toBe('INVALID_ARGUMENT');
    // An invalid event level is reported in the requested language wherever both options appear.
    const german = cli(['--events', 'verbose', '--lang', 'de', 'read', 'note.md']);
    expect(german.status).toBe(2);
    expect(german.body.error).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'Die Argumente oder Optionswerte sind für diesen Befehl ungültig.' });
    const workspace = await mkdtemp(join(tmpdir(), 'forge-event-settings-'));
    try {
      await mkdir(join(workspace, 'bin'));
      await writeFile(join(workspace, 'bin/config.json'), JSON.stringify({ settings: { events: 'all' } }));
      await writeFile(join(workspace, 'note.md'), '# Note\n');
      expect(ids(cli(['read', 'note.md'], undefined, { root: workspace }).body.events)).toContain('command.started');
      expect(cli(['config'], undefined, { root: workspace }).body.data.config.settings.events).toBe('all');
      expect(cli(['--events', 'changes', 'read', 'note.md'], undefined, { root: workspace }).body.events).toEqual([]);
    } finally { await rm(workspace, { recursive: true, force: true }); }
  }, workflowTimeout);

  it('reads, lists, validates and edits UTF-8 text files with revision guards', async () => {
    const read = cli(['read', 'src/x.ts']).body.data;
    expect(read.document).toEqual({ kind: 'text', content: 'export const a = 1;\n' });
    expect(cli(['list', '--kind', 'text']).body.data.files).toEqual(expect.arrayContaining([{ path: 'src/x.ts', kind: 'text' }]));
    expect(cli(['validate', 'src/x.ts']).body.data).toMatchObject({ valid: true, kind: 'text', validation: 'utf8' });
    const edited = cli(['edit', 'src/x.ts', '--find', 'a = 1', '--replace', 'a = 2', '--if-match', read.revision]);
    expect(edited.status).toBe(0);
    expect(ids(edited.body.events)).toEqual(['file.updated']);
    expect(await readFile(join(fixture.project, 'src/x.ts'), 'utf8')).toBe('export const a = 2;\n');
    await writeFile(join(fixture.project, 'src/broken.ts'), Buffer.from([0x61, 0xff, 0x0a]));
    expect(cli(['read', 'src/broken.ts']).body.data.document).toEqual({ kind: 'attachment', encoding: 'base64', content: Buffer.from([0x61, 0xff, 0x0a]).toString('base64') });
  }, workflowTimeout);

  it('previews dry-run edits as applicable diffs and rejects stale revisions without writing', async () => {
    const path = join(fixture.project, 'note.md'), before = await readFile(path, 'utf8');
    const { revision } = cli(['read', 'note.md']).body.data;
    const preview = cli(['edit', 'note.md', '--find', '# Note', '--replace', '# Renamed', '--if-match', revision, '--dry-run']);
    expect(preview.status).toBe(0);
    expect(preview.body.events).toEqual([]);
    const [change] = preview.body.data.changes;
    expect(change.diff).toContain('--- a/note.md\n+++ b/note.md\n');
    expect(await readFile(path, 'utf8')).toBe(before);
    const stale = cli(['edit', 'note.md', '--find', '# Note', '--replace', '# Renamed', '--if-match', '0'.repeat(64), '--dry-run']);
    expect(stale.status).toBe(2);
    expect(stale.body.error.code).toBe('CONFLICT');
    expect(cli(['edit', 'note.md', '--find', '# Note', '--replace', '# Renamed', '--if-match', revision]).status).toBe(0);
    expect(applyUnifiedDiff(before, change.diff)).toBe(await readFile(path, 'utf8'));
    const created = cli(['create', 'fresh.txt', '--content', 'hello\n', '--dry-run']).body.data.changes[0];
    expect(created.diff).toBe('--- /dev/null\n+++ b/fresh.txt\n@@ -0,0 +1 @@\n+hello\n');
  }, workflowTimeout);
});
