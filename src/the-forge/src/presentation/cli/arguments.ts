import { Command, CommanderError, Option } from 'commander';
import { forgeError, ensure } from '../../domain/shared/errors.ts';
import { commandOptions, ensureKnownAction, hasActionOptions, listOptionItems, option, optionTypes, type CommandMetadata, type CommandOption } from '../../application/plugins/command-metadata.ts';
import { globalOptions, requiredOptionMessage } from '../../application/plugins/command-input.ts';
import { unknownOption, unknownOptionGuidance } from './guidance.ts';
/** The global options as help and schema describe them; routing options select the workspace before the command loads. */
export const globalOptionMetadata = {
  root: option.string('Workspace root to load bin/config.json from; overrides FORGE_ROOT.'),
  lang: option.string('Response language for descriptions, hints and summaries.', { enum: ['en', 'de'], default: 'en' }),
  events: option.string('Events included in the response; delivery to listeners is unaffected.', { enum: ['none', 'changes', 'all'], default: 'changes' }),
  json: option.boolean('Compact JSON output.'),
  'no-json': option.boolean('Indented JSON output.'),
  'dry-run': option.boolean('Validate and preview writes without changing files.'),
  'no-dry-run': option.boolean('Write even when settings.dryRun is true.'),
  'no-plugins': option.boolean('Skip loading user plugins; core plugins stay.'),
  wait: option.string('Milliseconds (0 to 600000, default 0) a write waits for another Forge writer\'s lock while WORKSPACE_BUSY is retryable.'),
  help: option.boolean('Describe the command instead of running it.'),
  version: option.boolean('Report the Forge version; used without a command.'),
} satisfies Record<keyof typeof globalOptions, CommandOption>;
export interface ParsedArguments { args: string[]; flags: Record<string, string | boolean> }

/**
 * Routing options select the workspace and the loaded command catalog, so they are read before any command or plugin
 * option is known: the options before the command, then `--root` and `--no-plugins` anywhere before `--`. A flag token
 * is never an option value (see `parseArguments`), so a standalone `--root` is always the routing option, whatever the
 * command declares. `args` is the tail from the command id on.
 */
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
  const terminated = tokens[end] === '--', tail = tokens.slice(end + (terminated ? 1 : 0));
  const routing: string[] = [];
  for (let index = 0; !terminated && index < tail.length && tail[index] !== '--'; index++) {
    const token = tail[index]!;
    if (token === '--no-plugins' || token.startsWith('--root=')) routing.push(token);
    else if (token === '--root') { routing.push(token, ...tail.slice(index + 1, index + 2)); index++; }
  }
  const parsed = parseArguments([...tokens.slice(0, end), ...routing], globalOptions);
  return { flags: parsed.flags, args: tail };
}

/**
 * The complete invocation parsed with the global options and those `command` declares. An action's own options
 * (make <generator>) parse only once the action is known: the first argument after the command id, unless an option
 * precedes it.
 */
export function parseCommand(tokens: string[], command: CommandMetadata): ParsedArguments {
  const actionArgs = hasActionOptions(command) ? parseArguments(tokens, { ...globalOptions, ...optionTypes(command.options) }, true).args.slice(1) : [];
  try { return parseArguments(tokens, { ...globalOptions, ...optionTypes(commandOptions(command, actionArgs)) }); }
  catch (error) {
    // An unknown action outranks its options: make <unknown> --template fails with UNKNOWN_GENERATOR.
    ensureKnownAction(command, actionArgs);
    throw unknownOptionGuidance(error, command, actionArgs);
  }
}

/**
 * Enforces the option constraints that `help` and `schema` publish, after parsing and before the command runs: a
 * missing `required` option fails with MISSING_ARGUMENT and a value outside a string option's `enum` (for a `list`
 * option, any comma-separated item outside it) with INVALID_OPTION_VALUE, each naming the option in `details`.
 * Returns the flags the command receives: a `list` option's value as its items without surrounding whitespace,
 * joined by commas. Commands never repeat these checks.
 */
export function declaredValues(options: Readonly<Record<string, CommandOption>>, flags: Readonly<Record<string, string | boolean>>): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = Object.assign(Object.create(null) as Record<string, string | boolean>, flags);
  for (const [key, schema] of Object.entries(options)) {
    const given = Object.hasOwn(flags, key) ? flags[key] : undefined;
    if (given === undefined) {
      if (schema.required) throw forgeError('MISSING_ARGUMENT', requiredOptionMessage(key), { option: key });
      continue;
    }
    if (typeof given !== 'string') continue;
    const items = schema.list ? listOptionItems(given) : [given];
    if (schema.enum !== undefined && !items.every(item => schema.enum!.includes(item))) {
      const expected = schema.list ? 'a comma-separated list of' : 'one of';
      throw forgeError('INVALID_OPTION_VALUE', `--${key} must be ${expected}: ${schema.enum.join(', ')}.`, { option: key, value: given, allowed: [...schema.enum] });
    }
    if (schema.list) values[key] = items.join(',');
  }
  return values;
}

/**
 * A value-taking option never takes a following flag of this parse as its value: with an empty shell variable,
 * `edit --replace $EMPTY --dry-run` would otherwise replace with "--dry-run" and write for real. `--key=value`
 * passes any literal value, including one that starts with `--`.
 */
function ensureValuesAreNotFlags(tokens: readonly string[], options: Readonly<Record<string, 'string' | 'boolean'>>): void {
  const known = (key: string) => Object.hasOwn(options, key);
  const flag = (token: string) => token === '--' || (token === '-h' && known('help')) || (token === '-V' && known('version'))
    || (token.startsWith('--') && known(token.slice(2).split('=')[0]!));
  for (let index = 0; index < tokens.length && tokens[index] !== '--'; index++) {
    const token = tokens[index]!, key = token.slice(2);
    if (!token.startsWith('--') || token.includes('=') || !known(key) || options[key] !== 'string') continue;
    const next = tokens[++index];
    if (next !== undefined && flag(next)) {
      throw forgeError('MISSING_ARGUMENT', `--${key} needs a value, but ${next} follows it; write a literal value that starts with - as --${key}=<value>.`, { option: key });
    }
  }
}

/** Commander owns tokenization; normalize its options and errors into the agent protocol. */
export function parseArguments(tokens: string[], options: Record<string, 'string' | 'boolean'>, allowUnknown = false): ParsedArguments {
  ensureValuesAreNotFlags(tokens, options);
  const command = new Command('forge').helpOption(false).allowUnknownOption(allowUnknown).allowExcessArguments(true)
    .exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} }).showSuggestionAfterError(false);
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
    // Commander would suggest any parsed option, --version after a command included; suggestions follow the command.
    if (error.code === 'commander.unknownOption') throw unknownOption(error.message, Object.keys(options));
    const code = error.code === 'commander.optionMissingArgument' ? 'MISSING_ARGUMENT' : 'INVALID_ARGUMENT';
    throw forgeError(code, error.message.replace(/^error: /, ''));
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
