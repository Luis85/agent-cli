export interface EventDefinition<T = unknown> {
    id: string;
    validate: (payload: unknown) => payload is T;
}
export interface EventRecord {
    id: string;
    payload: unknown;
}
/** Invocation-scoped notifications. Listener errors cannot undo committed work. */
export declare class EventBus {
    private definitions;
    private listeners;
    private disposed;
    private depth;
    readonly history: EventRecord[];
    readonly warnings: string[];
    define<T>(definition: EventDefinition<T>): void;
    ids(): string[];
    on<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void;
    once<T = unknown>(id: string, listener: (payload: T) => void | Promise<void>): () => void;
    emit(id: string, payload: unknown): Promise<void>;
    warn(message: string): void;
    dispose(): void;
}
