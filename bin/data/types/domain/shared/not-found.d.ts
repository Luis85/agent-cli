/** Whether `error` is the host's NOT_FOUND failure for a missing file or folder. */
export declare function isNotFound(error: unknown): boolean;
/** The value `read` resolves to, or undefined when what it reads is missing (NOT_FOUND); other failures propagate. */
export declare function readOrMissing<T>(read: () => Promise<T>): Promise<T | undefined>;
