import { forgeError, ensure, isRecord, errorMessage } from '../../domain/shared/errors.ts';
import { isKernelMessage, kernelMessage, type KernelMessage } from '../../domain/shared/kernel-messages.ts';
import { isPluginWarning, pluginWarning, responseWarning, type Warning } from '../../domain/shared/warnings.ts';

export interface EventDefinition<T = unknown> { id: string; description?: string; validate: (payload: unknown) => payload is T }
export interface EventRecord { id: string; payload: unknown }
export interface EventDeliveryScope {
  depth(): number;
  run<T>(callback: () => Promise<T>): Promise<T>;
}
type Listener = { active: boolean; id?: string; invoke: (payload: unknown) => void | Promise<void> };
type Callback = () => void | Promise<void>;

/**
 * The event API a command or plugin receives as `context.events`. Host commands receive the invocation
 * bus itself; each plugin receives a channel that may emit only events in its own namespace.
 */
export interface EventChannel {
  ids(): string[];
  catalog(): Array<{ id: string; description?: string }>;
  on<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void;
  once<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void;
  onAny(listener: (record: EventRecord) => void | Promise<void>): () => void;
  replay(listener: (record: EventRecord) => void | Promise<void>): Promise<void>;
  emit(id: string, payload: unknown): Promise<void>;
  /**
   * Records a nonfatal warning for the response: text, or `{code, message, details?}` with the plugin's own
   * UPPER_SNAKE_CASE code, which starts with its id's prefix (`QUALITY_` for `quality`); text without a code, or a
   * code outside that namespace, reports as PLUGIN_WARNING. Host code passes kernel messages.
   */
  warn(message: string | KernelMessage | Warning): void;
  /** Like Obsidian's `workspace.onLayoutReady`: runs now when plugins are active, otherwise once they are. */
  onLayoutReady(callback: Callback): void;
  /** A best-effort task that runs after `workspace.quit`, before plugins unload. */
  onQuit(task: Callback): void;
}

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
export class EventBus implements EventChannel {
  private definitions = new Map<string, EventDefinition>();
  private listeners = new Set<Listener>();
  private disposed = false;
  private historyTruncated = false;
  private operationId = 0;
  private layoutReady = false;
  private readonly layoutCallbacks: Callback[] = [];
  private readonly quitTasks: Callback[] = [];
  private readonly settling = new Set<Promise<void>>();
  readonly history: EventRecord[] = [];
  /** Warnings in order: host messages by code for rendering in the response language, plugin warnings as captured. */
  readonly warningRecords: Array<KernelMessage | Warning> = [];
  /** The warning messages in English. */
  get warnings(): string[] { return this.warningRecords.map(warning => responseWarning(warning).message); }

  constructor(private readonly delivery: EventDeliveryScope) {}

  nextOperationId(): number { return ++this.operationId; }

  define<T>(definition: EventDefinition<T>): void { this.defineAll([definition]); }
  /** Validate a complete contribution batch before changing the bus. */
  defineAll(definitions: readonly EventDefinition[]): void {
    ensure(!this.disposed, 'INVALID_EVENT', 'Cannot define events after disposal.');
    const staged = new Map(this.definitions);
    for (const definition of definitions) {
      ensure(isRecord(definition) && typeof definition.id === 'string' && /^[a-z][a-zA-Z0-9-]*(\.[a-z][a-zA-Z0-9-]*)+$/.test(definition.id) && typeof definition.validate === 'function', 'INVALID_EVENT', 'Invalid event definition.');
      ensure(definition.description === undefined || (typeof definition.description === 'string' && definition.description.trim().length > 0), 'INVALID_EVENT', 'Event descriptions must be nonempty strings.');
      ensure(!staged.has(definition.id), 'DUPLICATE_EVENT', definition.id);
      staged.set(definition.id, definition);
    }
    this.definitions = staged;
  }
  ids(): string[] { return [...this.definitions.keys()].sort(); }
  catalog(): Array<{ id: string; description?: string }> {
    return this.ids().map(id => {
      const description = this.definitions.get(id)!.description;
      return { id, ...(description === undefined ? {} : { description }) };
    });
  }
  on<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void {
    ensure(!this.disposed && this.definitions.has(id), 'UNKNOWN_EVENT', id);
    ensure(typeof listener === 'function', 'INVALID_EVENT_LISTENER', 'Event listeners must be functions.');
    return this.subscribe({ active: true, id, invoke: listener as Listener['invoke'] });
  }
  onAny(listener: (record: EventRecord) => void | Promise<void>): () => void {
    ensure(!this.disposed, 'INVALID_EVENT', 'Cannot subscribe after disposal.');
    ensure(typeof listener === 'function', 'INVALID_EVENT_LISTENER', 'Event listeners must be functions.');
    return this.subscribe({ active: true, invoke: listener as Listener['invoke'] });
  }
  async replay(listener: (record: EventRecord) => void | Promise<void>): Promise<void> {
    ensure(!this.disposed, 'INVALID_EVENT', 'Cannot replay events after disposal.');
    ensure(typeof listener === 'function', 'INVALID_EVENT_LISTENER', 'Event listeners must be functions.');
    ensure(this.delivery.depth() < 32, 'EVENT_RECURSION', 'Event recursion exceeds 32.');
    const records = structuredClone(this.history);
    await this.delivery.run(async () => {
      for (const record of records) {
        if (this.disposed) break;
        try { await listener(record); }
        catch (error) { this.warn(kernelMessage('EVENT_REPLAY_FAILED', { event: record.id, diagnostic: errorMessage(error) })); }
      }
    });
  }
  private subscribe(entry: Listener): () => void {
    this.listeners.add(entry);
    return () => { entry.active = false; this.listeners.delete(entry); };
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
    } catch { throw forgeError('INVALID_EVENT_PAYLOAD', `Invalid payload for ${id}.`); }
    const depth = this.delivery.depth();
    ensure(depth < 32, 'EVENT_RECURSION', 'Event recursion exceeds 32.');
    if (this.history.length < 1000) this.history.push({ id, payload: structuredClone(snapshot) });
    else if (!this.historyTruncated) {
      this.historyTruncated = true;
      this.warn(kernelMessage('EVENT_HISTORY_FULL'));
    }
    await this.delivery.run(async () => {
      for (const entry of Array.from(this.listeners).filter(listener => listener.id === undefined || listener.id === id)) {
        if (!entry.active || this.disposed) continue;
        try { await entry.invoke(structuredClone(entry.id === undefined ? { id, payload: snapshot } : snapshot)); }
        catch (error) { this.warn(kernelMessage('EVENT_LISTENER_FAILED', { event: id, diagnostic: errorMessage(error) })); }
      }
    });
  }
  /**
   * Records a warning: a host message by code, a plugin warning as captured, and any other value as a plugin warning
   * (see pluginWarning) without a plugin, which keeps no code of its own, so no value can break the response.
   */
  warn(message: unknown): void {
    if (this.warningRecords.length < 1000) this.warningRecords.push(isKernelMessage(message) || isPluginWarning(message) ? message : pluginWarning(message));
  }
  onLayoutReady(callback: Callback): void {
    this.ensureCallback(callback);
    if (!this.layoutReady) { this.layoutCallbacks.push(callback); return; }
    const running = this.settle('LAYOUT_CALLBACK_FAILED', callback);
    this.settling.add(running);
    void running.then(() => this.settling.delete(running));
  }
  onQuit(task: Callback): void {
    this.ensureCallback(task);
    this.quitTasks.push(task);
  }
  /** Host: plugins are active. Queued layout callbacks run in registration order; failures become warnings. */
  async markLayoutReady(): Promise<void> {
    if (this.layoutReady) return;
    this.layoutReady = true;
    for (const callback of this.layoutCallbacks.splice(0)) await this.settle('LAYOUT_CALLBACK_FAILED', callback);
  }
  /** Host: settle immediate layout callbacks, then run quit tasks in order, including tasks added meanwhile. */
  async runQuitTasks(): Promise<void> {
    await Promise.allSettled(this.settling);
    for (let task = this.quitTasks.shift(); task; task = this.quitTasks.shift()) await this.settle('QUIT_TASK_FAILED', task);
  }
  private ensureCallback(callback: unknown): void {
    ensure(!this.disposed, 'INVALID_EVENT', 'Cannot schedule callbacks after disposal.');
    ensure(typeof callback === 'function', 'INVALID_EVENT_LISTENER', 'Lifecycle callbacks must be functions.');
  }
  private async settle(failure: 'LAYOUT_CALLBACK_FAILED' | 'QUIT_TASK_FAILED', callback: Callback): Promise<void> {
    try { await this.delivery.run(async () => { await callback(); }); }
    catch (error) {
      try { this.warn(kernelMessage(failure, { diagnostic: errorMessage(error) })); }
      catch { /* A failed diagnostic sink cannot stop the remaining lifecycle callbacks. */ }
    }
  }
  dispose(): void { this.disposed = true; this.listeners.clear(); }
}
