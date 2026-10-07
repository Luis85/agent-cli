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
/** Invocation-scoped notifications. Listener errors cannot undo committed work. */
export declare class EventBus {
    private readonly delivery;
    private definitions;
    private listeners;
    private disposed;
    private historyTruncated;
    private operationId;
    readonly history: EventRecord[];
    readonly warnings: string[];
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
    warn(message: string): void;
    dispose(): void;
}
