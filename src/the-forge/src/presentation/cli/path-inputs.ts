import { AppError, forgeError } from '../../domain/shared/errors.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import { commandOptions, type CommandFlags, type CommandMetadata } from '../../application/plugins/command-metadata.ts';

/** The absolute roots of an invocation: its scope (the selected project or the workspace) and the workspace. */
export interface PathScope { root: string; workspaceRoot: string }
/** Where a path value came from, as error details name it. */
type Source = { argument: string; index?: number } | { option: string };
/** `stdin`: the value names input that `--stdin` can carry instead (an option of a command that declares `--stdin`). */
interface Origin { source: Source; stdin: boolean }

const slashes = (path: string) => path.replaceAll('\\', '/');
const isAbsolute = (path: string) => path.startsWith('/') || /^[A-Za-z]:\//.test(path);
/** Windows drive letters name one drive in either case; everything else compares exactly. */
const comparable = (path: string) => (/^[A-Za-z]:/.test(path) ? path[0]!.toLowerCase() + path.slice(1) : path);

/** `path` (absolute, `/`-separated) relative to `root`, `''` for the root itself, or undefined outside it. */
function relativeTo(path: string, root: string): string | undefined {
  const base = comparable(slashes(root).replace(/\/+$/, '')), candidate = comparable(path);
  if (candidate === base) return '';
  return candidate.startsWith(`${base}/`) ? path.slice(base.length + 1) : undefined;
}

/**
 * The scope-relative POSIX form of a path an agent passed: `\` separators become `/`, leading `./` segments are
 * dropped and an absolute path inside the scope root becomes relative to it. Nothing else changes, so `..`, empty
 * segments and absolute paths outside the root still fail validation; symlinks are refused when the path is used.
 */
export function normalizeInputPath(input: string, root: string): string {
  let path = slashes(input);
  if (isAbsolute(path)) path = relativeTo(path, root) ?? path;
  while (path.startsWith('./')) path = path.slice(2);
  return path;
}

/** The path `..`, `.` and empty segments lead to, when it stays inside the root and names something. */
function resolved(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') { if (parts.pop() === undefined) return undefined; }
    else if (part !== '' && part !== '.') parts.push(part);
  }
  return parts.length > 0 ? parts.join('/') : undefined;
}

/** A corrected value to retry with, when one follows from the rejected path. */
function suggestion(input: string, path: string, origin: Origin, scope: PathScope): string | undefined {
  if (isAbsolute(path)) return origin.stdin && relativeTo(path, scope.workspaceRoot) === undefined ? '--stdin' : undefined;
  const fixed = resolved(path);
  if (fixed !== undefined && fixed !== input) { try { return vaultPath(fixed); } catch { return undefined; } }
  return origin.stdin && fixed === undefined ? '--stdin' : undefined;
}

/** Why an absolute path is refused, when that is not the generic path rule. */
function absoluteReason(path: string, scope: PathScope): string {
  if (!isAbsolute(path)) return '';
  const workspacePath = relativeTo(path, scope.workspaceRoot);
  if (workspacePath !== undefined && scope.root !== scope.workspaceRoot) return ' It lies outside the selected project; pass a path relative to the project root, or select the project that contains it.';
  return ' It lies outside the command scope root.';
}

/** The normalized value, validated as a vault path (one trailing `/` is left for the command to interpret). */
function checked(input: string, origin: Origin, scope: PathScope): string {
  const path = normalizeInputPath(input, scope.root);
  try { vaultPath(path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path); return path; }
  catch (error) {
    if (!(error instanceof AppError) || error.code !== 'INVALID_PATH') throw error;
    const { source } = origin;
    const named = 'option' in source ? `Option --${source.option}` : `Argument <${source.argument}>${source.index === undefined ? '' : ` at index ${source.index}`}`;
    const better = suggestion(input, path, origin, scope);
    const stdin = better === '--stdin' ? ' To use a file from outside the scope, pipe it with --stdin instead.' : '';
    throw forgeError('INVALID_PATH', `${named} ${JSON.stringify(input)}: ${error.message}${absoluteReason(path, scope)}${stdin}`, { ...source, value: input, ...(better === undefined ? {} : { suggestion: better }) });
  }
}

/**
 * The arguments and flags a command receives, with every value its metadata declares as a `path` normalized by
 * `normalizeInputPath` and validated. A rejected path fails with INVALID_PATH naming the argument or option in
 * `details` (`argument` or `option`, `value`) and, when one follows from it, `details.suggestion`: the resolved
 * path for one with `.`, `..` or empty segments that stays in the scope, or `--stdin` for a path option of a command
 * that reads `--stdin` when the file lies outside the workspace.
 */
export function normalizedPathInputs(command: CommandMetadata, args: readonly string[], flags: CommandFlags, scope: PathScope): [string[], CommandFlags] {
  const declared = command.args ?? [];
  const normalizedArgs = args.map((value, index) => {
    const variadic = index >= declared.length - 1 && declared.at(-1)?.variadic === true;
    const argument = variadic ? declared.at(-1) : declared[index];
    // A variadic argument's values are told apart by their zero-based position among all arguments.
    const source = { argument: argument?.name ?? '', ...(variadic ? { index } : {}) };
    return argument?.path === true ? checked(value, { source, stdin: false }, scope) : value;
  });
  const normalizedFlags: CommandFlags = Object.assign(Object.create(null) as CommandFlags, flags);
  const options = commandOptions(command, args), stdin = options.stdin?.type === 'boolean';
  for (const [key, option] of Object.entries(options)) {
    const value = flags[key];
    if (option.path === true && typeof value === 'string') normalizedFlags[key] = checked(value, { source: { option: key }, stdin }, scope);
  }
  return [normalizedArgs, normalizedFlags];
}
