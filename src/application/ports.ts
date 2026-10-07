import type { FileSnapshot, WriteRequest, FileChange } from '../domain/file.ts';

export interface FileRepository {
  read(path: string): Promise<FileSnapshot>;
  list(): Promise<string[]>;
  writeBatch(writes: readonly WriteRequest[], dryRun: boolean): Promise<FileChange[]>;
  remove(path: string, expectedRevision: string, dryRun: boolean): Promise<FileChange>;
}
export interface DocumentCodec {
  inspect(path: string, bytes: Uint8Array): unknown;
  validate(path: string, bytes: Uint8Array): void;
  properties(bytes: Uint8Array, changes: Record<string, unknown>): Uint8Array;
  patch(path: string, bytes: Uint8Array, pointer: string, value: unknown): Uint8Array;
}
