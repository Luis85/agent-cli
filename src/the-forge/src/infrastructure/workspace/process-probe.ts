/**
 * Whether process `pid` exists on this host: true when it does, also when it belongs to another user and cannot be
 * signalled (EPERM); false when there is no such process (ESRCH); undefined when the probe fails for another reason.
 */
export function processAlive(pid: number): boolean | undefined {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ESRCH' ? false : code === 'EPERM' ? true : undefined;
  }
}
