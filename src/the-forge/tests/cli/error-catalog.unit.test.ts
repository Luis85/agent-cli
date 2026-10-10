import { describe, expect, it } from 'vitest';
import { categoryExitCodes, errorCatalog, errorCodes, errorDefinition } from '../../src/domain/shared/error-catalog.ts';
import { AppError, ensure, forgeError, summarizeError } from '../../src/domain/shared/errors.ts';
import { germanErrors } from '../../src/presentation/localization/errors.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';

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
    expect(errorCodes.filter(code => errorCatalog[code].retryable)).toEqual(['WORKSPACE_BUSY']);
    expect(errorDefinition('PLUGIN_CUSTOM')).toBeUndefined();
    expect(errorDefinition('constructor')).toBeUndefined();
  });

  it('fixes exit statuses through the helpers, keeping only signal overrides', () => {
    expect(forgeError('NOT_FOUND', 'File not found: a.md')).toMatchObject({ code: 'NOT_FOUND', exitCode: 3 });
    expect(forgeError('WORKSPACE_BUSY', 'busy')).toMatchObject({ exitCode: 4 });
    expect(forgeError('UI_DRIFT', 'drift', { outputs: [] })).toMatchObject({ exitCode: 5, details: { outputs: [] } });
    expect(forgeError('CLAUDE_COMMAND_INTERRUPTED', 'SIGTERM', undefined, 143).exitCode).toBe(143);
    expect(() => ensure(false, 'CLAUDE_RUNTIME_FAILED', 'no status')).toThrow(expect.objectContaining({ exitCode: 1 }));
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
    const output = new Localizer().error(forgeError('WORKSPACE_BUSY', 'Lock held by pid 7.', { stale: 'active' }));
    expect(output).toEqual({ code: 'WORKSPACE_BUSY', message: 'Lock held by pid 7.', hint: errorCatalog.WORKSPACE_BUSY.hint, retryable: true, details: { stale: 'active' } });
    expect(new Localizer().error(new TypeError('boom'))).toEqual({ code: 'OPERATION_FAILED', message: 'boom', hint: errorCatalog.OPERATION_FAILED.hint, retryable: false });
  });

  it('localizes summary and hint in German while code, retryability and details stay stable', () => {
    const details = { path: 'note.md', expectedRevision: 'a', currentRevision: 'b' };
    const output = new Localizer('de').error(forgeError('CONFLICT', 'File changed; read again before editing: note.md', details));
    expect(output).toEqual({
      code: 'CONFLICT', message: germanErrors.CONFLICT.summary, hint: germanErrors.CONFLICT.hint, retryable: false,
      details: { ...details, localization: { originalMessage: 'File changed; read again before editing: note.md' } },
    });
  });

  it('keeps plugin-defined codes in their own shape', () => {
    for (const localizer of [new Localizer(), new Localizer('de')]) {
      expect(localizer.error(new AppError('PLUGIN_CUSTOM', 'Plugin-owned diagnostic', 7, { item: 1 }))).toEqual({ code: 'PLUGIN_CUSTOM', message: 'Plugin-owned diagnostic', details: { item: 1 } });
    }
  });

  it('lists German summaries in the schema catalog and leaves unknown entries untouched', () => {
    const errors = [{ code: 'NO_MATCH', exitCode: 2, category: 'input', retryable: false, summary: errorCatalog.NO_MATCH.summary }, { code: 'PLUGIN_CUSTOM', summary: 'Own' }];
    expect(new Localizer('de').result('schema', { generators: [], errors })).toEqual({
      generators: [], errors: [{ ...errors[0], summary: germanErrors.NO_MATCH.summary }, errors[1]],
    });
    expect(new Localizer().result('schema', { errors })).toEqual({ errors });
  });
});
