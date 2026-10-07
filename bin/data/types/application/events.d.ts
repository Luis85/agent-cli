export interface EventDefinition<T = unknown> {
    id: string;
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
    readonly history: EventRecord[];
    readonly warnings: string[];
    constructor(delivery: EventDeliveryScope);
    define<T>(definition: EventDefinition<T>): void;
    /** Validate a complete contribution batch before changing the bus. */
    defineAll(definitions: readonly EventDefinition[]): void;
    ids(): string[];
    on<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void;
    once<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void;
    emit(id: string, payload: unknown): Promise<void>;
    warn(message: string): void;
    dispose(): void;
}
