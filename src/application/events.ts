import { AppError, ensure, isRecord } from '../domain/errors.ts';

export interface EventDefinition<T = unknown> { id: string; validate: (payload: unknown) => payload is T }
export interface EventRecord { id: string; payload: unknown }
type Listener = { active: boolean; invoke: (payload: unknown) => void | Promise<void> };

/** The CLI event log must survive JSON encoding without omissions or coercion. */
function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  if (array && (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index)))) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(item => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

/** Invocation-scoped notifications. Listener errors cannot undo committed work. */
export class EventBus {
  private definitions = new Map<string, EventDefinition>();
  private listeners = new Map<string, Set<Listener>>();
  private disposed = false;
  private depth = 0;
  readonly history: EventRecord[] = [];
  readonly warnings: string[] = [];

  define<T>(definition: EventDefinition<T>): void { this.defineAll([definition]); }
  /** Validate a complete contribution batch before changing the bus. */
  defineAll(definitions: readonly EventDefinition[]): void {
    ensure(!this.disposed, 'INVALID_EVENT', 'Cannot define events after disposal.');
    const staged = new Map(this.definitions);
    for (const definition of definitions) {
      ensure(isRecord(definition) && typeof definition.id === 'string' && /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(definition.id) && typeof definition.validate === 'function', 'INVALID_EVENT', 'Invalid event definition.');
      ensure(!staged.has(definition.id), 'DUPLICATE_EVENT', definition.id);
      staged.set(definition.id, definition);
    }
    this.definitions = staged;
  }
  ids(): string[] { return [...this.definitions.keys()].sort(); }
  on<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void {
    ensure(!this.disposed && this.definitions.has(id), 'UNKNOWN_EVENT', id);
    ensure(typeof listener === 'function', 'INVALID_EVENT_LISTENER', 'Event listeners must be functions.');
    const entry: Listener = { active: true, invoke: listener as Listener['invoke'] };
    const entries = this.listeners.get(id) ?? new Set();
    entries.add(entry); this.listeners.set(id, entries);
    return () => { entry.active = false; entries.delete(entry); };
  }
  once<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void {
    ensure(typeof listener === 'function', 'INVALID_EVENT_LISTENER', 'Event listeners must be functions.');
    const off = this.on<T>(id, async payload => { off(); await listener(payload); });
    return off;
  }
  async emit(id: string, payload: unknown): Promise<void> {
    ensure(!this.disposed && this.definitions.has(id), 'UNKNOWN_EVENT', id);
    let snapshot: unknown;
    try {
      ensure(isJsonValue(payload), 'INVALID_EVENT_PAYLOAD', id);
      snapshot = structuredClone(payload);
      ensure(isJsonValue(snapshot), 'INVALID_EVENT_PAYLOAD', id);
      const valid: unknown = this.definitions.get(id)!.validate(structuredClone(snapshot));
      // JavaScript plugins can accidentally supply an async guard despite the SDK.
      // Drain its rejection while rejecting the unsupported asynchronous result.
      if (valid instanceof Promise) void valid.catch(() => {});
      ensure(valid === true, 'INVALID_EVENT_PAYLOAD', id);
    } catch { throw new AppError('INVALID_EVENT_PAYLOAD', `Invalid payload for ${id}.`, 2); }
    ensure(this.depth < 32, 'EVENT_RECURSION', 'Event recursion exceeds 32.');
    if (this.history.length < 1000) this.history.push({ id, payload: structuredClone(snapshot) });
    this.depth++;
    try {
      for (const entry of [...(this.listeners.get(id) ?? [])]) {
        if (!entry.active || this.disposed) continue;
        try { await entry.invoke(structuredClone(snapshot)); }
        catch (error) { this.warn(`Listener ${id}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    } finally { this.depth--; }
  }
  warn(message: string): void { if (this.warnings.length < 1000) this.warnings.push(message); }
  dispose(): void { this.disposed = true; this.listeners.clear(); }
}
