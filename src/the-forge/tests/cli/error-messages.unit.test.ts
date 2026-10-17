import { describe, expect, it } from 'vitest';
import { forgeError } from '../../src/domain/shared/errors.ts';
import type { ErrorCode } from '../../src/domain/shared/error-catalog.ts';
import { germanErrors } from '../../src/presentation/localization/errors.ts';
import { germanErrorMessage, templatedErrorCodes } from '../../src/presentation/localization/error-messages.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';

const german = (code: ErrorCode, details?: Record<string, unknown>) => new Localizer('de').error(forgeError(code, 'English diagnostic', details)).message;

describe('German error messages with the values of the occurrence', () => {
  it('names the path, command, option and revisions the details hold', () => {
    expect(german('NOT_FOUND', { path: 'notes/a.md' })).toBe('Die Datei oder Ressource notes/a.md wurde nicht gefunden.');
    expect(german('NOT_FOUND', { path: 'c.md', alreadyDeleted: true, trashPath: '.trash/c.md' })).toBe('Die Datei c.md wurde nicht gefunden; ein Löschvorgang hat sie bereits nach .trash/c.md verschoben.');
    expect(german('UNKNOWN_COMMAND', { command: 'lst', suggestions: ['list'] })).toBe('Der Befehl lst ist nicht registriert.');
    expect(german('UNKNOWN_OPTION', { option: '--nope', command: 'read', suggestions: [] })).toBe('Der Befehl read akzeptiert die Option --nope nicht.');
    expect(german('UNKNOWN_OPTION', { option: '--nope', suggestions: [] })).toBe('Die Option --nope wird nicht akzeptiert.');
    expect(german('MISSING_ARGUMENT', { option: 'replace', next: '--dry-run' })).toBe('Die Option --replace benötigt einen Wert, aber --dry-run folgt ihr; einen Wert, der mit - beginnt, schreiben Sie als --replace=<Wert>.');
    expect(german('MISSING_ARGUMENT', { option: 'if-match' })).toContain('data.revision aus read oder stat');
    expect(german('MISSING_ARGUMENT', { option: 'to' })).toBe('Die Option --to ist erforderlich.');
    expect(german('INVALID_OPTION_VALUE', { option: 'events', value: 'some', allowed: ['none', 'changes', 'all'] })).toBe('--events erlaubt "some" nicht; gültige Werte (bei einer kommagetrennten Listenoption mehrere davon): none, changes, all.');
    expect(german('UNKNOWN_GENERATOR', { generator: 'entty', allowed: ['entity', 'use-case'] })).toBe('Unbekannter Generator entty; verfügbar sind entity, use-case.');
    expect(german('DESTINATION_EXISTS', { path: 'b.md', from: 'a.md' })).toBe('Das Ziel b.md existiert bereits.');
  });

  it('describes each CONFLICT case and locates apply plan operations', () => {
    expect(german('CONFLICT', { path: 'a.md', expectedRevision: 'r1', currentRevision: 'r2' })).toBe('a.md wurde seit dem Lesen geändert: erwartet r1, aktuell r2.');
    expect(german('CONFLICT', { path: 'a.md', expectedRevision: null, currentRevision: 'r2' })).toBe('a.md existiert bereits mit der Revision r2.');
    expect(german('CONFLICT', { path: 'a.md', expectedRevision: 'r1', currentRevision: null })).toBe('a.md existiert nicht, erwartet wurde die Revision r1.');
    expect(german('CONFLICT', { path: 'a.md', expectedRevision: 'r1', currentRevision: 'r2', alreadyApplied: true })).toBe('a.md enthält die angeforderte Änderung bereits (Revision r2); ein erneuter Versuch ist nicht nötig.');
    expect(german('CONFLICT', { operation: 2, path: 'a.md', expectedRevision: 'r1', currentRevision: 'r2' })).toBe('Vorgang 2: a.md wurde seit dem Lesen geändert: erwartet r1, aktuell r2.');
  });

  it('names the argument, option and value of a rejected path', () => {
    expect(german('INVALID_PATH', { argument: 'path', value: '../a.md' })).toBe('Argument <path> "../a.md" ist kein gültiger relativer Pfad im Workspace oder Projekt.');
    expect(german('INVALID_PATH', { argument: 'paths', index: 1, value: 'a//b.md', suggestion: 'a/b.md' })).toBe('Argument <paths> an Position 1 "a//b.md" ist kein gültiger relativer Pfad im Workspace oder Projekt; gemeint ist vermutlich a/b.md.');
    expect(german('INVALID_PATH', { option: 'from', value: '/tmp/x.md', suggestion: '--stdin' })).toContain('mit --stdin weiter');
    expect(german('INVALID_PATH', { argument: 'path', value: 'notes/con.md', segment: 'con.md' })).toBe('Argument <path> "notes/con.md": con.md ist ein unter Windows reservierter Gerätename (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM1-COM9, COM¹-COM³, LPT1-LPT9 oder LPT¹-LPT³, mit beliebiger Endung); benennen Sie die Datei oder den Ordner um.');
    expect(german('INVALID_PATH', { path: 'notes', entry: 'caf�.md' })).toBe('Der Ordner notes enthält einen Eintrag, dessen Name kein gültiges UTF-8 ist: caf�.md.');
  });

  it('names the missing arguments and counts of an arity failure, and the offending value of other argument failures', () => {
    expect(german('INVALID_ARGUMENT', { minimum: 2, maximum: 2, received: 1, missing: ['to'] })).toBe('Es fehlt <to>: Falsche Anzahl an Positionsargumenten, erwartet 2, erhalten 1.');
    expect(german('INVALID_ARGUMENT', { minimum: 0, maximum: 1, received: 3 })).toBe('Falsche Anzahl an Positionsargumenten: erwartet 0 bis 1, erhalten 3.');
    expect(german('INVALID_ARGUMENT', { action: 'lst', allowed: ['list', 'show'], suggestions: ['list'] })).toBe('Unbekannte Aktion lst; verfügbar sind list, show.');
    expect(german('INVALID_ARGUMENT', { total: 3 })).toBe('--lines beginnt nach der letzten Zeile; der Text hat 3 Zeile(n).');
  });

  it('locates a failure at an argument value that its message does not name, also by the summary', () => {
    expect(german('NOT_FOUND', { argument: 'paths', index: 1, path: 'b.md' })).toBe('Argument <paths> an Position 1: Die Datei oder Ressource b.md wurde nicht gefunden.');
    expect(german('INVALID_FRONTMATTER', { argument: 'paths', index: 0, path: 'a.md' })).toBe(`Argument <paths> an Position 0: ${germanErrors.INVALID_FRONTMATTER.summary}`);
    expect(german('INVALID_PATH', { argument: 'paths', index: 1, value: '../b.md' })).toBe('Argument <paths> an Position 1 "../b.md" ist kein gültiger relativer Pfad im Workspace oder Projekt.');
  });

  it('keeps the summary when no template covers the details, and the English diagnostic in every case', () => {
    expect(german('INVALID_ARGUMENT')).toBe(germanErrors.INVALID_ARGUMENT.summary);
    expect(german('NOT_FOUND', { path: { nested: true } })).toBe(germanErrors.NOT_FOUND.summary);
    expect(german('CONFLICT', { expectedRevision: 'r1' })).toBe(germanErrors.CONFLICT.summary);
    expect(germanErrorMessage('WORKSPACE_BUSY', { path: '.agent-cli.lock' })).toBeUndefined();
    const output = new Localizer('de').error(forgeError('NOT_FOUND', 'File not found: a.md', { path: 'a.md' }));
    expect(output.details).toEqual({ path: 'a.md', localization: { originalMessage: 'File not found: a.md' } });
    expect(new Localizer('en').error(forgeError('NOT_FOUND', 'File not found: a.md', { path: 'a.md' })).message).toBe('File not found: a.md');
  });

  it('covers at least the codes agents meet most', () => {
    expect(templatedErrorCodes).toEqual(expect.arrayContaining(['NOT_FOUND', 'UNKNOWN_COMMAND', 'UNKNOWN_OPTION', 'INVALID_ARGUMENT', 'MISSING_ARGUMENT', 'CONFLICT', 'INVALID_PATH']));
  });
});
