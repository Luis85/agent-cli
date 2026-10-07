import { Command, CommanderError, Option } from 'commander';
import { AppError, ensure } from '../domain/errors.ts';
export const globalOptions = {
  root: 'string', json: 'boolean', 'no-json': 'boolean',
  'dry-run': 'boolean', 'no-dry-run': 'boolean', 'no-plugins': 'boolean',
  help: 'boolean', version: 'boolean',
} as const;
export interface ParsedArguments { args: string[]; flags: Record<string, string | boolean> }

/** Routing options precede the command so unknown plugin arguments cannot
 * influence which workspace/configuration is loaded during discovery. */
export function parseBootstrap(tokens: string[]): ParsedArguments {
  let end = 0;
  while (end < tokens.length) {
    const token = tokens[end]!;
    if (token === '--' || !token.startsWith('-')) break;
    const key = token.startsWith('--') ? token.slice(2).split('=')[0]! : token === '-h' ? 'help' : token === '-V' ? 'version' : token;
    const type = Object.hasOwn(globalOptions, key) ? globalOptions[key as keyof typeof globalOptions] : undefined;
    // Let Commander report unknown/malformed prefix options without treating
    // any following token as a command or configuration input.
    if (!type) { parseArguments(tokens.slice(0, end + 1), globalOptions); }
    end += type === 'string' && !token.includes('=') ? 2 : 1;
  }
  const parsed = parseArguments(tokens.slice(0, end), globalOptions);
  return { flags: parsed.flags, args: tokens.slice(end + (tokens[end] === '--' ? 1 : 0)) };
}

/** Commander owns tokenization; normalize its options and errors into the agent protocol. */
export function parseArguments(tokens: string[], options: Record<string, 'string' | 'boolean'>, allowUnknown = false): ParsedArguments {
  const command = new Command('forge').helpOption(false).allowUnknownOption(allowUnknown).allowExcessArguments(true)
    .exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });
  const seen = new Set<string>();
  const descriptors: Array<{ key: string; option: Option }> = [];
  for (const [key, type] of Object.entries(options)) {
    const short = key === 'help' ? '-h, ' : key === 'version' ? '-V, ' : '';
    const option = new Option(`${short}--${key}${type === 'string' ? ' <value>' : ''}`);
    // A plugin string option such as --no-label takes a literal value; only
    // boolean options use Commander's negation and shared positive attribute.
    if (type === 'string') option.negate = false;
    descriptors.push({ key, option }); command.addOption(option);
    command.on(`option:${option.name()}`, () => {
      const attribute = option.attributeName();
      ensure(!seen.has(attribute), 'DUPLICATE_OPTION', `Repeated or contradictory option --${key}.`);
      seen.add(attribute);
    });
  }
  try { command.parse(tokens, { from: 'user' }); }
  catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    const code = error.code === 'commander.unknownOption' ? 'UNKNOWN_OPTION' : error.code === 'commander.optionMissingArgument' ? 'MISSING_ARGUMENT' : 'INVALID_ARGUMENT';
    throw new AppError(code, error.message.replace(/^error: /, ''), 2);
  }
  const flags: Record<string, string | boolean> = Object.create(null) as Record<string, string | boolean>;
  for (const { key, option } of descriptors) {
    if (!seen.has(option.attributeName())) continue;
    const parsed: unknown = command.getOptionValue(option.attributeName());
    // Positive and negative forms share a Commander attribute; report only the selected form.
    if (option.negate) { if (parsed === false) flags[key] = true; }
    else if (typeof parsed === 'string' || parsed === true) flags[key] = parsed;
  }
  return { args: command.args, flags };
}
export function value(flags: ParsedArguments['flags'], key: string, required = false): string | undefined {
  const result = flags[key];
  ensure(!required || typeof result === 'string', 'MISSING_ARGUMENT', `--${key} is required.`);
  return typeof result === 'string' ? result : undefined;
}
export function arity(args: string[], min: number, max = min): void { ensure(args.length >= min && args.length <= max, 'INVALID_ARGUMENT', `Expected ${min === max ? min : `${min}–${max}`} positional arguments.`); }
