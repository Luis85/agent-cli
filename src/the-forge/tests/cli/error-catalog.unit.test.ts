import { describe, expect, it } from 'vitest';
import { categoryExitCodes, errorCatalog, errorCodes, errorDefinition } from '../../src/domain/shared/error-catalog.ts';
import { AppError, ensure, forgeError, summarizeError } from '../../src/domain/shared/errors.ts';
import { germanErrors } from '../../src/presentation/localization/errors.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { builtinCommands } from '../support/builtin-commands.ts';

describe('error catalog contract', () => {
  it('derives every exit status from its category and gives every code a summary and an actionable hint', () => {
    for (const code of errorCodes) {
      const definition = errorCatalog[code];
      expect(code).toMatch(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/);
      expect(definition.exitCode, code).toBe(categoryExitCodes[definition.category]);
      expect(definition.summary.trim().length, code).toBeGreaterThan(0);
      expect(definition.hint.trim().length, code).toBeGreaterThan(0);
      expect(definition.hint, code).not.toBe(definition.summary);
    }
    expect(errorCodes.filter(code => errorCatalog[code].retryable)).toEqual(['SERVER_STOP_FAILED', 'SERVER_BUSY', 'WORKSPACE_BUSY']);
    expect(errorDefinition('PLUGIN_CUSTOM')).toBeUndefined();
    expect(errorDefinition('constructor')).toBeUndefined();
  });

  it('fixes exit statuses through the helpers, keeping only signal overrides', () => {
    expect(forgeError('NOT_FOUND', 'File not found: a.md')).toMatchObject({ code: 'NOT_FOUND', exitCode: 3 });
    expect(forgeError('WORKSPACE_BUSY', 'busy')).toMatchObject({ exitCode: 4 });
    expect(forgeError('SERVER_BUSY', 'lifecycle busy')).toMatchObject({ exitCode: 4 });
    expect(forgeError('SERVER_STATE_INVALID', 'unsafe state')).toMatchObject({ exitCode: 2 });
    expect(forgeError('SERVER_START_FAILED', 'startup failed')).toMatchObject({ exitCode: 1 });
    expect(forgeError('SERVER_STOP_FAILED', 'shutdown failed')).toMatchObject({ exitCode: 1 });
    expect(forgeError('GENERATION_DRIFT', 'drift', { outputs: [] })).toMatchObject({ exitCode: 5, details: { outputs: [] } });
    expect(forgeError('OPERATION_FAILED', 'SIGTERM', undefined, 143).exitCode).toBe(143);
    expect(() => ensure(false, 'OPERATION_FAILED', 'no status')).toThrow(expect.objectContaining({ exitCode: 1 }));
    expect(() => ensure(false, 'CONFLICT', 'stale', { currentRevision: null })).toThrow(expect.objectContaining({ exitCode: 2, details: { currentRevision: null } }));
    expect(summarizeError(new Error('plain'))).toEqual({ code: 'OPERATION_FAILED', exitCode: 1 });
  });

  it('translates every catalogued code into German', () => {
    expect(Object.keys(germanErrors).sort()).toEqual([...errorCodes].sort());
    for (const code of errorCodes) {
      expect(germanErrors[code].summary, code).not.toBe(errorCatalog[code].summary);
      expect(germanErrors[code].hint.trim().length, code).toBeGreaterThan(0);
    }
  });
});

describe('failure envelope guidance', () => {
  it('adds the catalog hint and retryability to English failures without changing the diagnostic', () => {
    const output = new Localizer().error(forgeError('WORKSPACE_BUSY', 'Lock held by pid 7.', { path: '.agent-cli.lock' }));
    expect(output).toEqual({ code: 'WORKSPACE_BUSY', message: 'Lock held by pid 7.', hint: errorCatalog.WORKSPACE_BUSY.hint, retryable: true, details: { path: '.agent-cli.lock' } });
    expect(new Localizer().error(new TypeError('boom'))).toEqual({ code: 'OPERATION_FAILED', message: 'boom', hint: errorCatalog.OPERATION_FAILED.hint, retryable: false });
  });

  it('localizes the message with the occurrence\'s values and the hint in German while code, retryability and details stay stable', () => {
    const details = { path: 'note.md', expectedRevision: 'a', currentRevision: 'b' };
    const output = new Localizer('de').error(forgeError('CONFLICT', 'File changed; read again before editing: note.md', details));
    expect(output).toEqual({
      code: 'CONFLICT', message: 'note.md wurde seit dem Lesen geändert: erwartet a, aktuell b.', hint: germanErrors.CONFLICT.hint, retryable: false,
      details: { ...details, localization: { originalMessage: 'File changed; read again before editing: note.md' } },
    });
  });

  it('refines the hint by the occurrence detail a code names, in both languages', () => {
    const variants = errorCatalog.WORKSPACE_BUSY.variants!;
    expect(variants.details).toEqual(['nestedWriter', 'stale']);
    expect(Object.keys(variants.hints).sort()).toEqual(['active', 'running', 'stale', 'unknown']);
    expect(Object.keys(germanErrors.WORKSPACE_BUSY.variants).sort()).toEqual(['active', 'running', 'stale', 'unknown']);
    for (const stale of ['active', 'stale', 'unknown'] as const) {
      const error = forgeError('WORKSPACE_BUSY', 'busy', { stale }, undefined, stale === 'active');
      expect(new Localizer().error(error).hint, stale).toBe(variants.hints[stale]);
      expect(new Localizer('de').error(error).hint, stale).toBe(germanErrors.WORKSPACE_BUSY.variants[stale]);
    }
    expect(variants.hints.active).toContain('--wait');
    expect(variants.hints.unknown).not.toContain('--wait <ms>');
    // A running nested root's writer is not waited for, so its hint never suggests rerunning with --wait.
    const nested = forgeError('WORKSPACE_BUSY', 'busy', { stale: 'active', nestedWriter: 'running' }, undefined, true);
    expect(new Localizer().error(nested).hint).toBe(variants.hints.running);
    expect(new Localizer('de').error(nested).hint).toBe(germanErrors.WORKSPACE_BUSY.variants.running);
    expect(variants.hints.running).not.toContain('--wait <ms>');
    expect(germanErrors.WORKSPACE_BUSY.variants.running).not.toContain('--wait <ms>');
    // A detail value without a variant, or a code without variants, keeps the code's own hint.
    expect(new Localizer().error(forgeError('WORKSPACE_BUSY', 'busy', { stale: 'other' })).hint).toBe(errorCatalog.WORKSPACE_BUSY.hint);
    expect(new Localizer('de').error(forgeError('WORKSPACE_BUSY', 'busy', { stale: 'toString' })).hint).toBe(germanErrors.WORKSPACE_BUSY.hint);
    expect(new Localizer().error(forgeError('CONFLICT', 'stale', { stale: 'active' })).hint).toBe(errorCatalog.CONFLICT.hint);
  });

  it('keeps plugin-defined codes in their own shape', () => {
    for (const localizer of [new Localizer(), new Localizer('de')]) {
      expect(localizer.error(new AppError('PLUGIN_CUSTOM', 'Plugin-owned diagnostic', 7, { item: 1 }))).toEqual({ code: 'PLUGIN_CUSTOM', message: 'Plugin-owned diagnostic', details: { item: 1 } });
    }
  });

  it('lists German summaries in the schema catalog and leaves unknown entries untouched', () => {
    const errors = [{ code: 'NO_MATCH', exitCode: 2, category: 'input', retryable: false, summary: errorCatalog.NO_MATCH.summary }, { code: 'PLUGIN_CUSTOM', summary: 'Own' }];
    const schema = builtinCommands().commands.get('schema');
    expect(new Localizer('de').result(schema, { generators: [], errors })).toEqual({
      generators: [], errors: [{ ...errors[0], summary: germanErrors.NO_MATCH.summary }, errors[1]],
    });
    expect(new Localizer().result(schema, { errors })).toEqual({ errors });
  });
});
