import { ensure } from '../domain/errors.ts';

export interface EventDefinition<T = unknown> { id: string; validate: (payload: unknown) => payload is T }
export interface EventRecord { id: string; payload: unknown }
type Listener = { active: boolean; invoke: (payload: unknown) => void | Promise<void> };

/** Invocation-scoped notifications. Listener errors cannot undo committed work. */
export class EventBus {
  private definitions = new Map<string, EventDefinition>();
  private listeners = new Map<string, Set<Listener>>();
  private disposed = false;
  private depth = 0;
  readonly history: EventRecord[] = [];
  readonly warnings: string[] = [];

  define<T>(definition: EventDefinition<T>): void {
    ensure(!this.disposed && /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(definition.id) && typeof definition.validate === 'function', 'INVALID_EVENT', 'Invalid event definition.');
    ensure(!this.definitions.has(definition.id), 'DUPLICATE_EVENT', definition.id);
    this.definitions.set(definition.id, definition);
  }
  ids(): string[] { return [...this.definitions.keys()].sort(); }
  on<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void {
    ensure(!this.disposed && this.definitions.has(id), 'UNKNOWN_EVENT', id);
    const entry: Listener = { active: true, invoke: listener as Listener['invoke'] };
    const entries = this.listeners.get(id) ?? new Set();
    entries.add(entry); this.listeners.set(id, entries);
    return () => { entry.active = false; entries.delete(entry); };
  }
  once<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void {
    const off = this.on<T>(id, async payload => { off(); await listener(payload); });
    return off;
  }
  async emit(id: string, payload: unknown): Promise<void> {
    ensure(!this.disposed && this.definitions.has(id), 'UNKNOWN_EVENT', id);
    const snapshot: unknown = structuredClone(payload);
    ensure(this.definitions.get(id)!.validate(snapshot), 'INVALID_EVENT_PAYLOAD', id);
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
