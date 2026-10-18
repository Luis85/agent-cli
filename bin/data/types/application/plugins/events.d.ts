import { type KernelMessage } from '../../domain/shared/kernel-messages.ts';
import { type Warning } from '../../domain/shared/warnings.ts';
export interface EventDefinition<T = unknown> {
    id: string;
    description?: string;
    validate: (payload: unknown) => payload is T;
}
export interface EventRecord {
    id: string;
    payload: unknown;
}
export interface EventDeliveryScope {
    depth(): number;
    run<T>(callback: () => Promise<T>): Promise<T>;
}
type Callback = () => void | Promise<void>;
/**
 * The event API a command or plugin receives as `context.events`. Host commands receive the invocation
 * bus itself; each plugin receives a channel that may emit only events in its own namespace.
 */
export interface EventChannel {
    ids(): string[];
    catalog(): Array<{
        id: string;
        description?: string;
    }>;
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
/** Invocation-scoped notifications. Listener errors cannot undo committed work. */
export declare class EventBus implements EventChannel {
    private readonly delivery;
    private definitions;
    private listeners;
    private disposed;
    private historyTruncated;
    private operationId;
    private layoutReady;
    private readonly layoutCallbacks;
    private readonly quitTasks;
    private readonly settling;
    readonly history: EventRecord[];
    /** Warnings in order: host messages by code for rendering in the response language, plugin warnings as captured. */
    readonly warningRecords: Array<KernelMessage | Warning>;
    /** The warning messages in English. */
    get warnings(): string[];
    constructor(delivery: EventDeliveryScope);
    nextOperationId(): number;
    define<T>(definition: EventDefinition<T>): void;
    /** Validate a complete contribution batch before changing the bus. */
    defineAll(definitions: readonly EventDefinition[]): void;
    ids(): string[];
    catalog(): Array<{
        id: string;
        description?: string;
    }>;
    on<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void;
    onAny(listener: (record: EventRecord) => void | Promise<void>): () => void;
    replay(listener: (record: EventRecord) => void | Promise<void>): Promise<void>;
    private subscribe;
    once<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void;
    emit(id: string, payload: unknown): Promise<void>;
    /**
     * Records a warning: a host message by code, a plugin warning as captured, and any other value as a plugin warning
     * (see pluginWarning) without a plugin, which keeps no code of its own, so no value can break the response.
     */
    warn(message: unknown): void;
    onLayoutReady(callback: Callback): void;
    onQuit(task: Callback): void;
    /** Host: plugins are active. Queued layout callbacks run in registration order; failures become warnings. */
    markLayoutReady(): Promise<void>;
    /** Host: settle immediate layout callbacks, then run quit tasks in order, including tasks added meanwhile. */
    runQuitTasks(): Promise<void>;
    private ensureCallback;
    private settle;
    dispose(): void;
}
export {};
