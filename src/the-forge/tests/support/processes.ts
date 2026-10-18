import { execFile } from 'node:child_process';

/** A finished child process: its exit status (null after a signal), its output, and the error when it could not start or timed out. */
export interface FinishedProcess { status: number | null; stdout: string; stderr: string; error?: Error }

/**
 * Runs `file` like `spawnSync`, but without blocking the test worker: an event loop kept busy by synchronous child
 * processes delays the worker's RPC with Vitest past its 60 s limit. A non-zero exit resolves with its status.
 */
export function runProcess(file: string, args: readonly string[], options: { cwd: string; timeout: number; shell?: boolean }): Promise<FinishedProcess> {
  return new Promise(resolve => {
    execFile(file, args, { ...options, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) resolve({ status: 0, stdout, stderr });
      // A numeric code is the exit status; a string code (ENOENT) or a kill (the timeout) means the process did not finish.
      else if (typeof error.code === 'number' && !error.killed) resolve({ status: error.code, stdout, stderr });
      else resolve({ status: null, stdout, stderr, error });
    });
  });
}
