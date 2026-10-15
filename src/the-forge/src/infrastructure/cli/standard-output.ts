/** Install terminal transport handling once, before any command writes its response. */
export function standardOutput(): (text: string) => void {
  let reportedFailure = false;
  function failed(error: unknown): void {
    // Only expose a short operating-system code, never arbitrary error messages or paths.
    const value = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const code = typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(value) ? value : 'UNKNOWN';
    // Early pipe consumers intentionally stop reading; preserve the command's status.
    if (code === 'EPIPE' || code === 'EOF') process.exit(process.exitCode ?? 0);
    process.exitCode ||= 1;
    if (reportedFailure) return;
    reportedFailure = true;
    try {
      process.stderr.write(`The Forge could not write standard output (${code}). Check the output destination and available storage. Command effects may already be committed; inspect state before retrying.\n`);
    } catch { /* No usable diagnostic channel remains; the nonzero status still signals failure. */ }
  }
  process.stdout.on('error', failed);
  // A broken diagnostic destination must not interrupt commands or trigger a second failure.
  process.stderr.on('error', () => {});
  return text => {
    try { process.stdout.write(text); }
    catch (error) { failed(error); }
  };
}
