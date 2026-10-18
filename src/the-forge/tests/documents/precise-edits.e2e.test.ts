import { describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { writeVault } from '../support/vault.ts';

const fixture = portableCli();

async function vault(name: string) {
  const root = join(fixture.project, name);
  await mkdir(root, { recursive: true });
  await writeVault(root, {
    'notes/Plan.md': '---\nstatus: draft\n---\n# Plan\n\n## Risks\n\n- Scope\n\n## Goals\n\nShip it soon. ^ship\n',
    'notes/Scratch.md': 'scratch\n',
    'Index.md': '# Index\n\nSee [[Plan]] and [[Plan#^ship|shipping]].\n',
  });
  const cli = (args: string[], input?: string) => fixture.cli(args, input, { root });
  const revision = async (path: string) => (await cli(['read', path])).body.data.revision as string;
  const text = (path: string) => readFile(join(root, path), 'utf8');
  return { root, cli, revision, text };
}

describe('precise edits through the portable CLI', () => {
  it('edits a section, a block and several literals with dry-run diffs and revision guards', async () => {
    const { cli, revision, text } = await vault('edits');
    const preview = await cli(['edit', 'notes/Plan.md', '--section', 'Plan > Risks', '--append', '--content', '- Staffing', '--if-match', await revision('notes/Plan.md'), '--dry-run']);
    expect(preview.body.data.changes[0].diff).toContain(' - Scope\n+- Staffing\n');
    expect(await text('notes/Plan.md')).not.toContain('Staffing');
    expect((await cli(['edit', 'notes/Plan.md', '--section', 'Plan > Risks', '--append', '--content', '- Staffing', '--if-match', await revision('notes/Plan.md')])).body.ok).toBe(true);
    expect((await cli(['edit', 'notes/Plan.md', '--block', 'ship', '--replace', 'Ship it now.', '--if-match', await revision('notes/Plan.md')])).body.ok).toBe(true);
    const edits = JSON.stringify([{ find: 'status: draft', replace: 'status: active' }, { find: 'Scope', replace: 'Scope creep' }]);
    const edited = await cli(['edit', 'notes/Plan.md', '--edits', '-', '--if-match', await revision('notes/Plan.md')], edits);
    expect(edited.body.events.map((event: { id: string }) => event.id)).toEqual(['vault.modify']);
    expect(await text('notes/Plan.md')).toBe('---\nstatus: active\n---\n# Plan\n\n## Risks\n\n- Scope creep\n- Staffing\n\n## Goals\n\nShip it now. ^ship\n');

    const missing = await cli(['edit', 'notes/Plan.md', '--section', 'Plan > Budget', '--replace', 'x', '--if-match', await revision('notes/Plan.md')]);
    expect(missing.status).toBe(2);
    expect(missing.body.error).toMatchObject({ code: 'SECTION_NOT_FOUND', details: { section: 'Plan > Budget', headings: [{ section: 'Plan', line: 4 }, { section: 'Plan > Risks', line: 6 }, { section: 'Plan > Goals', line: 11 }] } });
    const failing = await cli(['edit', 'notes/Plan.md', '--edits', JSON.stringify([{ find: 'Plan', replace: 'Roadmap', all: true }, { find: 'absent', replace: '' }]), '--if-match', await revision('notes/Plan.md')]);
    expect(failing.body.error).toMatchObject({ code: 'NO_MATCH', details: { edit: 1 } });
    expect((await cli(['edit', 'notes/Plan.md', '--section', 'Risks', '--prepend', '--if-match', 'x'])).body.error.code).toBe('INVALID_INPUT');
    expect((await cli(['edit', 'notes/Plan.md', '--block', 'ship', '--section-line', '4', '--replace', 'x', '--if-match', 'x'])).body.error.code).toBe('INVALID_INPUT');
    expect((await cli(['edit', 'notes/Plan.md', '--section', 'Plan', '--section-line', '0', '--replace', 'x', '--if-match', 'x'])).body.error.code).toBe('INVALID_ARGUMENT');
    const pinned = await cli(['edit', 'notes/Plan.md', '--section', 'Plan', '--section-line', '5', '--replace', 'x', '--if-match', await revision('notes/Plan.md')]);
    expect(pinned.body.error).toMatchObject({ code: 'SECTION_NOT_FOUND', details: { line: 5, headings: [{ section: 'Plan', line: 4 }] } });
    expect((await cli(['edit', 'notes/Plan.md', '--section', 'Goals', '--section-line', '11', '--append', '--content', 'Later.', '--if-match', await revision('notes/Plan.md'), '--dry-run'])).body.ok).toBe(true);
    const german = await cli(['--lang', 'de', 'edit', 'notes/Plan.md', '--block', 'nope', '--append', '--content', 'x', '--if-match', await revision('notes/Plan.md')]);
    expect(german.body.error).toMatchObject({ code: 'SECTION_NOT_FOUND', message: 'Keine Überschrift passt zum --section-Pfad, oder kein Block hat die --block-ID.' });
  });

  it('refuses literal edits that would put NUL characters into a text file', async () => {
    const { cli, revision, text } = await vault('nul-bytes');
    expect((await cli(['write', 'notes/list.txt', '--content', 'one\ntwo\n'])).body.ok).toBe(true);
    const nul = await cli(['edit', 'notes/list.txt', '--edits', '-', '--if-match', await revision('notes/list.txt')], JSON.stringify([{ find: 'two', replace: 'tw\u0000o' }]));
    expect(nul.status).toBe(2);
    expect(nul.body.error.code).toBe('INVALID_ENCODING');
    expect(await text('notes/list.txt')).toBe('one\ntwo\n');
    expect((await cli(['read', 'notes/list.txt'])).body.data.document).toEqual({ kind: 'text', content: 'one\ntwo\n' });
  });

  it('applies a mixed plan from a file or standard input in one guarded batch', async () => {
    const { root, cli, revision, text } = await vault('apply');
    const planRevision = await revision('notes/Plan.md');
    const plan = { version: 1, operations: [
      { op: 'edit', path: 'notes/Plan.md', section: 'Goals', append: 'Ship v2 later.', ifMatch: planRevision },
      { op: 'frontmatter', path: 'notes/Plan.md', set: { status: 'active' }, unset: [], ifMatch: planRevision },
      { op: 'move', from: 'notes/Plan.md', to: 'specs/Roadmap.md', ifMatch: planRevision },
      { op: 'write', path: 'specs/README.md', content: 'Specs live here; start at [[Roadmap]].\n' },
      { op: 'delete', path: 'notes/Scratch.md', ifMatch: await revision('notes/Scratch.md') },
    ] };
    await cli(['write', 'plan.json', '--content', JSON.stringify(plan)]);
    const preview = await cli(['apply', 'plan.json', '--dry-run']);
    expect(preview.body).toMatchObject({ ok: true, data: { dryRun: true }, events: [] });
    expect(preview.body.data.changes.map((change: { path: string; diff: string | null }) => [change.path, typeof change.diff])).toEqual([['Index.md', 'string'], ['specs/README.md', 'string'], ['specs/Roadmap.md', 'string']]);
    expect((await readdir(join(root, 'notes'))).sort()).toEqual(['Plan.md', 'Scratch.md']);

    const indexRevision = await revision('Index.md');
    const applied = await cli(['apply', '-', '--events', 'all'], JSON.stringify(plan));
    expect(applied.body.ok).toBe(true);
    const ids = applied.body.events.map((event: { id: string }) => event.id);
    expect(ids.filter((id: string) => id.startsWith('operation.'))).toEqual(['operation.started', 'operation.succeeded']);
    expect(ids.filter((id: string) => id.startsWith('vault.'))).toEqual(['vault.create', 'vault.rename', 'vault.delete', 'vault.modify', 'vault.create', 'vault.modify']);
    expect(ids.filter((id: string) => id === 'metadataCache.resolved')).toHaveLength(1);
    expect(await text('specs/Roadmap.md')).toBe('---\nstatus: active\n---\n# Plan\n\n## Risks\n\n- Scope\n\n## Goals\n\nShip it soon. ^ship\n\nShip v2 later.\n');
    expect(await text('Index.md')).toBe('# Index\n\nSee [[Roadmap]] and [[Roadmap#^ship|shipping]].\n');
    expect(await text('.trash/notes/Scratch.md')).toBe('scratch\n');

    const again = await cli(['apply', 'plan.json']);
    expect(again.status).toBe(3);
    expect(again.body.error).toMatchObject({ code: 'NOT_FOUND', details: { operation: 0 } });
    const stale = await cli(['apply', '-'], JSON.stringify({ version: 1, operations: [
      { op: 'write', path: 'notes/Next.md', content: 'next\n' },
      { op: 'edit', path: 'Index.md', append: 'More.\n', ifMatch: indexRevision },
    ] }));
    expect(stale.status).toBe(2);
    expect(stale.body.error).toMatchObject({ code: 'CONFLICT', details: { operation: 1, path: 'Index.md', expectedRevision: indexRevision, currentRevision: await revision('Index.md') } });
    expect((await readdir(join(root, 'notes'))).sort()).toEqual([]);
    const invalid = await cli(['apply', '-'], JSON.stringify({ version: 1, operations: [{ op: 'move', from: 'Index.md' }] }));
    expect(invalid.body.error).toMatchObject({ code: 'INVALID_PLAN', details: { operation: 0, issues: ['plan.operations[0].to: is required'] } });
  });

  it('publishes the plan schema with the apply command', async () => {
    const help = await fixture.cli(['help', 'apply']);
    expect(help.body.data).toMatchObject({ id: 'apply', usage: 'apply <plan.json|-> [--project id]', annotations: { mutating: true, scope: 'project' } });
    expect(help.body.data.args[0].schema).toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Forge apply plan', required: ['version', 'operations'] });
    const schema = (await fixture.cli(['schema', '--all'])).body.data;
    const edit = schema.commands.find((command: { id: string }) => command.id === 'edit');
    expect(edit.options.edits.schema).toMatchObject({ type: 'array', minItems: 1 });
    expect(edit.errors).toEqual(expect.arrayContaining(['SECTION_NOT_FOUND', 'AMBIGUOUS_SECTION']));
    expect(schema.errors.map((error: { code: string }) => error.code)).toEqual(expect.arrayContaining(['SECTION_NOT_FOUND', 'AMBIGUOUS_SECTION', 'INVALID_PLAN']));
    expect((await fixture.cli(['--lang', 'de', 'help', 'apply'])).body.data.description).toMatch(/^Einen JSON-Plan/);
  });
});
