import { ensure } from '../domain/errors.ts';
export const globalOptions = { root: 'string', json: 'boolean', 'dry-run': 'boolean', plugins: 'string', help: 'boolean', version: 'boolean' } as const;
export interface ParsedArguments { args: string[]; flags: Record<string, string | boolean> }
export function parseArguments(tokens: string[], options: Record<string, 'string' | 'boolean'>, allowUnknown = false): ParsedArguments {
  const args: string[] = [], flags: Record<string, string | boolean> = Object.create(null) as Record<string, string | boolean>;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === '--') { args.push(...tokens.slice(i + 1)); break; }
    if (!token.startsWith('--')) { ensure(!token.startsWith('-'), 'INVALID_ARGUMENT', `Unknown short option ${token}; use --help.`); args.push(token); continue; }
    const equals = token.indexOf('=');
    const key = token.slice(2, equals === -1 ? undefined : equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    const type = options[key];
    if (!type && allowUnknown) continue;
    ensure(type, 'UNKNOWN_OPTION', `Unknown option --${key}.`);
    ensure(!Object.hasOwn(flags, key), 'DUPLICATE_OPTION', `Repeated option --${key}.`);
    if (type === 'boolean') {
      ensure(inline === undefined || ['true', 'false'].includes(inline), 'INVALID_ARGUMENT', `--${key} accepts true or false.`);
      flags[key] = inline !== 'false';
    } else {
      const value = inline ?? tokens[++i];
      ensure(value !== undefined && !value.startsWith('--'), 'MISSING_ARGUMENT', `--${key} requires a value.`);
      flags[key] = value;
    }
  }
  return { args, flags };
}
export function value(flags: ParsedArguments['flags'], key: string, required = false): string | undefined {
  const result = flags[key];
  ensure(!required || typeof result === 'string', 'MISSING_ARGUMENT', `--${key} is required.`);
  return typeof result === 'string' ? result : undefined;
}
export function arity(args: string[], min: number, max = min): void { ensure(args.length >= min && args.length <= max, 'INVALID_ARGUMENT', `Expected ${min === max ? min : `${min}–${max}`} positional arguments.`); }
