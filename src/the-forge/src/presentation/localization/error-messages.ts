import { fill, type MessageParams } from '../../domain/shared/messages.ts';
import type { ErrorCode } from '../../domain/shared/error-catalog.ts';

type Details = Readonly<Record<string, unknown>>;
/** A template and, optionally, the occurrences it describes; the first one whose placeholders all have values wins. */
interface Template { text: string; when?: (details: Details) => boolean }

const scalar = (value: unknown): value is string | number => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
const names = (value: unknown) => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string') ? value as string[] : undefined;

/**
 * The values German templates name, from an error's details: every text or number detail as given, plus `named` (the
 * argument or option a path came from), `quoted` (the rejected value as JSON), `range` (the expected argument count),
 * `missingArguments` and `allowedValues` (lists joined for the sentence).
 */
function templateValues(details: Details): MessageParams {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(details)) if (scalar(value)) values[key] = value;
  if (typeof details.option === 'string') values.named = `Option --${details.option}`;
  if (typeof details.argument === 'string') values.named = `Argument <${details.argument}>${typeof details.index === 'number' ? ` an Position ${details.index}` : ''}`;
  if (typeof details.value === 'string') values.quoted = JSON.stringify(details.value);
  if (typeof details.minimum === 'number' && typeof details.maximum === 'number') values.range = details.minimum === details.maximum ? details.minimum : `${details.minimum} bis ${details.maximum}`;
  const missing = names(details.missing), allowed = names(details.allowed);
  if (missing) values.missingArguments = missing.map(name => `<${name}>`).join(' ');
  if (allowed) values.allowedValues = allowed.join(', ');
  return values;
}

const device = '{segment} ist ein unter Windows reservierter Gerätename (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM1-COM9, COM¹-COM³, LPT1-LPT9 oder LPT¹-LPT³, mit beliebiger Endung); benennen Sie die Datei oder den Ordner um.';
const stdin = (details: Details) => details.suggestion === '--stdin';

/**
 * German messages that keep the concrete values of an occurrence (the path, command, option or revision) for the
 * codes agents meet most, filled from `error.details`. An occurrence whose details no template covers keeps the
 * code's summary; the English diagnostic always stays in `details.localization.originalMessage`.
 */
const templates: Partial<Record<ErrorCode, readonly Template[]>> = {
  NOT_FOUND: [
    { text: 'Die Datei {path} wurde nicht gefunden; ein Löschvorgang hat sie bereits nach {trashPath} verschoben.', when: details => details.alreadyDeleted === true },
    { text: 'Die Datei oder Ressource {path} wurde nicht gefunden.' },
  ],
  UNKNOWN_COMMAND: [{ text: 'Der Befehl {command} ist nicht registriert.' }],
  UNKNOWN_OPTION: [{ text: 'Der Befehl {command} akzeptiert die Option {option} nicht.' }, { text: 'Die Option {option} wird nicht akzeptiert.' }],
  MISSING_ARGUMENT: [
    { text: 'Die Option --{option} benötigt einen Wert, aber {next} folgt ihr; einen Wert, der mit - beginnt, schreiben Sie als --{option}=<Wert>.' },
    { text: '--if-match ist erforderlich: Übergeben Sie die aktuelle Revision, data.revision aus read oder stat (auch ein Probelauf von move, rename oder delete meldet sie).', when: details => details.option === 'if-match' },
    { text: 'Die Option --{option} ist erforderlich.' },
  ],
  INVALID_ARGUMENT: [
    { text: 'Es fehlt {missingArguments}: Falsche Anzahl an Positionsargumenten, erwartet {range}, erhalten {received}.' },
    { text: 'Falsche Anzahl an Positionsargumenten: erwartet {range}, erhalten {received}.' },
    { text: 'Unbekannte Aktion {action}; verfügbar sind {allowedValues}.' },
    { text: 'Jeder Pfad darf nur einmal vorkommen; er steht bereits an Position {duplicateOf}.' },
    { text: 'Die gelesenen Dateien umfassen {bytes} Bytes und überschreiten die Gesamtgrenze von {aggregateLimit} Bytes; senken Sie --max-bytes (derzeit {maxBytes}) oder lesen Sie weniger Dateien.' },
    { text: '--lines beginnt nach der letzten Zeile; der Text hat {total} Zeile(n).' },
  ],
  INVALID_OPTION_VALUE: [{ text: '--{option} erlaubt {quoted} nicht; gültige Werte (bei einer kommagetrennten Listenoption mehrere davon): {allowedValues}.' }],
  UNKNOWN_GENERATOR: [{ text: 'Unbekannter Generator {generator}; verfügbar sind {allowedValues}.' }],
  CONFLICT: [
    { text: '{path} wurde geändert, während die Linkaktualisierungen geplant wurden; wiederholen Sie den Befehl.', when: details => details.reason === 'changed-while-planning' },
    { text: 'Keine Revision schützt {path}: Übergeben Sie die aktuelle Revision {currentRevision} mit --if-match (ifMatch in einem apply-Plan), um die Datei zu ändern oder zu löschen.', when: details => details.reason === 'revision-required' },
    { text: '{path} enthält die angeforderte Änderung bereits (Revision {currentRevision}); ein erneuter Versuch ist nicht nötig.', when: details => details.alreadyApplied === true },
    { text: '{path} existiert bereits mit der Revision {currentRevision}.', when: details => details.expectedRevision === null },
    { text: '{path} existiert nicht, erwartet wurde die Revision {expectedRevision}.', when: details => details.currentRevision === null },
    { text: '{path} wurde seit dem Lesen geändert: erwartet {expectedRevision}, aktuell {currentRevision}.' },
  ],
  DESTINATION_EXISTS: [{ text: 'Das Ziel {path} existiert bereits.' }],
  INVALID_PATH: [
    { text: `{named} {quoted}: ${device}` },
    { text: '{named} {quoted} ist kein gültiger relativer Pfad im Workspace oder Projekt; leiten Sie eine Datei außerhalb des Bereichs stattdessen mit --stdin weiter.', when: stdin },
    { text: '{named} {quoted} ist kein gültiger relativer Pfad im Workspace oder Projekt; gemeint ist vermutlich {suggestion}.' },
    { text: '{named} {quoted} ist kein gültiger relativer Pfad im Workspace oder Projekt.' },
    { text: device },
    { text: 'Der Pfad {path} ist auf diesem Dateisystem nicht verwendbar ({reason}).' },
    { text: 'Der Ordner {path} enthält einen Eintrag, dessen Name kein gültiges UTF-8 ist: {entry}.' },
  ],
  INVALID_PLUGIN: [
    { text: 'Die Datei {file} des Skills {skill} trägt den unter Windows reservierten Gerätenamen {segment}, den kein Windows-System installieren kann; benennen Sie sie um.', when: details => details.reason === 'device-name' },
    { text: 'Die Skill-ID {skill} ist ein unter Windows reservierter Gerätename, den kein Skill-Ordner unter Windows tragen kann; wählen Sie eine andere ID.', when: details => details.reason === 'device-name' },
    { text: 'Die Datei {file} des Skills {skill} bezeichnet dieselbe Datei wie {duplicateOf}, wenn Groß- und Kleinschreibung und abschließende Punkte nicht zählen, wie unter Windows und macOS; benennen Sie eine davon um.', when: details => details.reason === 'case-duplicate' },
    { text: 'Die Datei {file} des Skills {skill} ist zugleich der Ordner von {duplicateOf}; ein Pfad kann nicht Datei und Ordner zugleich sein.', when: details => details.reason === 'folder-conflict' },
  ],
};

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!);

/** The German message of a built-in failure with its concrete values, when a template covers its details. */
export function germanErrorMessage(code: ErrorCode, details: Details | undefined): string | undefined {
  const candidates = templates[code];
  if (candidates === undefined || details === undefined) return undefined;
  const values = templateValues(details);
  const template = candidates.find(entry => (entry.when?.(details) ?? true) && placeholders(entry.text).every(name => Object.hasOwn(values, name)));
  if (template === undefined) return undefined;
  return location(details, template.text) + fill(template.text, values);
}

/**
 * The position an occurrence names, as the English message does: an operation of an apply plan, or an argument value
 * (a read-many path) that `text` does not already name with `{named}`.
 */
function location(details: Details, text: string): string {
  if (typeof details.operation === 'number') return `Vorgang ${details.operation}: `;
  return typeof details.argument === 'string' && !placeholders(text).includes('named') ? `${templateValues(details).named}: ` : '';
}

/** A built-in code's German summary, located like a templated message when no template covers the details. */
export function locatedGermanSummary(details: Details | undefined, summary: string): string {
  return details === undefined ? summary : location(details, summary) + summary;
}

/** The codes with German message templates, for tests. */
export const templatedErrorCodes = Object.keys(templates) as ErrorCode[];
