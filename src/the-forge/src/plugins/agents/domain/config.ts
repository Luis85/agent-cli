/**
 * docker-agent configuration documents as Forge reads them: the parsed YAML value of one definition file, checked
 * against the vendored JSON Schema before any rule here relies on its shape. Helpers stay defensive anyway, because
 * semantic checks also run on documents with schema errors to report as much as possible at once.
 */
export type AgentConfigDocument = Record<string, unknown>;
export type Severity = 'error' | 'warning' | 'info';
/** Mapping fidelity: exact, approximate (warned) or unsupported (not emitted). */
export type Fidelity = 'E' | 'A' | 'U';

/** One finding about a definition file; `pointer` is an RFC 6901 JSON pointer into the parsed document. */
export interface AgentDiagnostic {
  severity: Severity; code: string; pointer: string; message: string;
  fidelity?: Fidelity;
  /** 1-based position of the pointed value in the YAML source, when known. */
  line?: number; column?: number;
}

/** The docker-agent configuration version this Forge release reads; absent means this version. */
export const supportedConfigVersion = '16';

export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export const stringList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
export const record = (value: unknown): Record<string, unknown> => isObject(value) ? value : {};

/** RFC 6901 pointer from path segments. */
export function pointer(...segments: Array<string | number>): string {
  return segments.map(segment => `/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');
}

/** Pointer segments, unescaped. */
export function pointerSegments(path: string): string[] {
  return path === '' ? [] : path.slice(1).split('/').map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

export function diagnostic(severity: Severity, code: string, path: string, message: string, fidelity?: Fidelity): AgentDiagnostic {
  return { severity, code, pointer: path, message, ...(fidelity ? { fidelity } : {}) };
}

/** The agents of a document in declaration order. */
export function agentEntries(config: AgentConfigDocument): Array<[string, Record<string, unknown>]> {
  return Object.entries(record(config.agents)).map(([name, agent]) => [name, record(agent)]);
}

/** docker-agent's default agent: `root` when present, otherwise the first declared agent. */
export function defaultAgent(config: AgentConfigDocument): string | undefined {
  const names = Object.keys(record(config.agents));
  return names.includes('root') ? 'root' : names[0];
}

/** An agent's instruction text: a string, or a list joined with blank lines like docker-agent. */
export function instructionText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return stringList(value).join('\n\n');
  return undefined;
}

/** `instruction_file` as a list of relative paths. */
export function instructionFiles(agent: Record<string, unknown>): string[] {
  return typeof agent.instruction_file === 'string' ? [agent.instruction_file] : stringList(agent.instruction_file);
}

export const hasErrors = (diagnostics: readonly AgentDiagnostic[]) => diagnostics.some(entry => entry.severity === 'error');
