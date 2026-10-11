import { Command, CommanderError, Option } from 'commander';
import { forgeError, ensure } from '../../domain/shared/errors.ts';
import { option, type CommandOption } from '../../application/plugins/command-metadata.ts';
import { globalOptions } from '../../application/plugins/command-input.ts';
/** The global options as help and schema describe them; routing options must precede the command. */
export const globalOptionMetadata = {
  root: option.string('Workspace root to load bin/config.json from; must precede the command.'),
  lang: option.string('Response language for descriptions, hints and summaries.', { enum: ['en', 'de'], default: 'en' }),
  events: option.string('Events included in the response; delivery to listeners is unaffected.', { enum: ['none', 'changes', 'all'], default: 'changes' }),
  json: option.boolean('Compact JSON output.'),
  'no-json': option.boolean('Indented JSON output.'),
  'dry-run': option.boolean('Validate and preview writes without changing files.'),
  'no-dry-run': option.boolean('Write even when settings.dryRun is true.'),
  'no-plugins': option.boolean('Skip loading user plugins; core plugins stay. Must precede the command.'),
  help: option.boolean('Describe the command instead of running it.'),
  version: option.boolean('Report the Forge version; used without a command.'),
} satisfies Record<keyof typeof globalOptions, CommandOption>;
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
