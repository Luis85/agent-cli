import { describe, expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';

const { cli } = portableCli();
// Each workflow spawns several CLI processes; allow for slow shared CI hosts.
const workflowTimeout = 30000;
const revision = (path: string): string => cli(['read', path]).body.data.revision;

describe('actionable failures', () => {
  it('separates a missing find text from an ambiguous one', () => {
    expect(cli(['create', 'plan.md', '--content', '# Plan\nDraft\n\nDraft notes\n']).status).toBe(0);
    const before = revision('plan.md');
    const missing = cli(['edit', 'plan.md', '--find', 'Final', '--replace', 'Ready', '--if-match', before]);
    expect(missing.status).toBe(2);
    expect(missing.body.error).toEqual({ code: 'NO_MATCH', message: expect.any(String), hint: expect.stringContaining('--find'), retryable: false, details: { find: 'Final', matches: 0 } });
    const ambiguous = cli(['edit', 'plan.md', '--find', 'Draft', '--replace', 'Ready', '--if-match', before, '--dry-run']);
    expect(ambiguous.status).toBe(2);
    expect(ambiguous.body.error).toMatchObject({ code: 'AMBIGUOUS_EDIT', retryable: false, details: { matches: 2, lines: [2, 4] } });
    expect(revision('plan.md')).toBe(before);
    expect(cli(['edit', 'plan.md', '--find', 'Draft notes', '--replace', 'Ready notes', '--if-match', before]).status).toBe(0);
  }, workflowTimeout);

  it('reports the current revision on stale guarded writes, including dry runs', () => {
    expect(cli(['create', 'board.canvas']).status).toBe(0);
    const stale = revision('plan.md');
    expect(cli(['edit', 'plan.md', '--append', '--content', 'More\n', '--if-match', stale]).status).toBe(0);
    const current = revision('plan.md');
    const attempts = [
      ['write', 'plan.md', '--content', 'Replaced\n', '--if-match', stale],
      ['edit', 'plan.md', '--append', '--content', 'Again\n', '--if-match', stale, '--dry-run'],
      ['properties', 'plan.md', '--set', '{"status":"done"}', '--if-match', stale],
      ['write', 'plan.md', '--content', 'Unguarded\n'],
    ];
    for (const args of attempts) {
      const result = cli(args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.body.error).toMatchObject({ code: 'CONFLICT', retryable: false, hint: expect.stringContaining('currentRevision'), details: { path: 'plan.md', currentRevision: current } });
      expect(result.body.error.details.expectedRevision).toBe(args.includes('--if-match') ? stale : null);
    }
    const canvas = cli(['patch', 'board.canvas', '--pointer', '/nodes/-', '--value', '{}', '--if-match', stale]);
    expect(canvas.body.error).toMatchObject({ code: 'CONFLICT', details: { path: 'board.canvas', currentRevision: revision('board.canvas') } });
    const absent = cli(['write', 'absent.md', '--content', 'x', '--if-match', stale, '--dry-run']);
    expect(absent.body.error).toMatchObject({ code: 'CONFLICT', details: { path: 'absent.md', expectedRevision: stale, currentRevision: null } });
    expect(cli(['read', 'plan.md']).body.data.document.content).toBe('# Plan\nDraft\n\nReady notes\nMore\n');
  }, workflowTimeout);

  it('publishes the error catalog through schema and localizes it without changing codes', () => {
    const english = cli(['schema']).body.data.errors as Array<Record<string, unknown>>;
    expect(english).toEqual(expect.arrayContaining([
      { code: 'NO_MATCH', exitCode: 2, category: 'input', retryable: false, summary: expect.any(String) },
      { code: 'WORKSPACE_BUSY', exitCode: 4, category: 'busy', retryable: true, summary: expect.any(String) },
      { code: 'NOT_FOUND', exitCode: 3, category: 'not-found', retryable: false, summary: expect.any(String) },
    ]));
    const german = cli(['--lang', 'de', 'schema']).body.data.errors as Array<Record<string, unknown>>;
    expect(german.map(entry => entry.code)).toEqual(english.map(entry => entry.code));
    expect(german.find(entry => entry.code === 'NO_MATCH')!.summary).toBe('Der --find-Text kommt in der Datei nicht vor.');
    expect(cli(['help']).body.data).not.toHaveProperty('errors');

    const failure = cli(['--lang', 'de', 'edit', 'plan.md', '--find', 'Absent', '--replace', 'x', '--if-match', revision('plan.md')]);
    const original = cli(['edit', 'plan.md', '--find', 'Absent', '--replace', 'x', '--if-match', revision('plan.md')]);
    expect(failure.status).toBe(2);
    expect(failure.body.error).toEqual({
      code: 'NO_MATCH', message: 'Der --find-Text kommt in der Datei nicht vor.', hint: expect.stringContaining('Lesen Sie die Datei erneut'), retryable: false,
      details: { find: 'Absent', matches: 0, localization: { originalMessage: original.body.error.message } },
    });
    const missing = cli(['read', 'missing.md']);
    expect(missing.status).toBe(3);
    expect(missing.body.error).toMatchObject({ code: 'NOT_FOUND', hint: expect.stringContaining('list') });
  }, workflowTimeout);
});
