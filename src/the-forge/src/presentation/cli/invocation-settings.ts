import { value } from '../../application/plugins/command-input.ts';
import { eventOutput, eventOutputLevels, type EventOutput } from '../../application/plugins/event-output.ts';
import type { AppConfig } from '../../application/workspace/config.ts';
import { language } from '../localization/localization.ts';

type Flags = Readonly<Record<string, string | boolean>>;
/** The response language and format, write mode and response event output of one invocation. */
export type InvocationSettings = AppConfig['settings'];

const validLevel = (level: string): level is EventOutput => (eventOutputLevels as readonly string[]).includes(level);

/** A boolean setting a flag pair overrides: `--no-<name>` wins over `--<name>`, which wins over `configured`. */
export function flagSetting(flags: Flags, name: string, configured: boolean): boolean {
  return flags[`no-${name}`] ? false : flags[name] ? true : configured;
}

/**
 * The output format the tokens state before `--`, or undefined. A flag token is never an option value, so this
 * agrees with the complete parse and also formats failures before or during parsing.
 */
function statedJson(tokens: readonly string[]): boolean | undefined {
  const end = tokens.indexOf('--'), options = end === -1 ? tokens : tokens.slice(0, end);
  return options.includes('--no-json') ? false : options.includes('--json') ? true : undefined;
}

/** The `--lang` of `flags` (INVALID_LANGUAGE when unsupported), else `current`. */
export function requestedLanguage(flags: Flags, current: InvocationSettings['language']): InvocationSettings['language'] {
  const requested = value(flags, 'lang');
  return requested === undefined ? current : language(requested);
}

/**
 * Before the configuration loads: the requested language applies first, so every later bootstrap failure is reported
 * in it, and the output format as the tokens state it. An invalid prefix `--events` fails only once the command is
 * parsed, unless --help describes the command instead.
 */
export function bootstrapSettings(tokens: readonly string[], prefix: Flags): InvocationSettings {
  const events = value(prefix, 'events');
  return { language: requestedLanguage(prefix, 'en'), json: statedJson(tokens) ?? false, dryRun: false, events: events !== undefined && validLevel(events) ? events : 'changes' };
}

/** The configured settings with the bootstrap flags and stated output format applied over them. */
export function configuredSettings(configured: InvocationSettings, bootstrap: InvocationSettings, tokens: readonly string[], prefix: Flags): InvocationSettings {
  return {
    language: value(prefix, 'lang') !== undefined ? bootstrap.language : configured.language,
    json: statedJson(tokens) ?? configured.json,
    dryRun: flagSetting(prefix, 'dry-run', configured.dryRun),
    events: value(prefix, 'events') !== undefined ? bootstrap.events : configured.events,
  };
}

/**
 * The `--events` of the parsed invocation (INVALID_OPTION_VALUE when invalid), else `current`. help describes a
 * command without running it, so no declared value applies to it, an invalid global --events included.
 */
export function requestedEvents(flags: Flags, current: EventOutput): EventOutput {
  const requested = value(flags, 'events');
  return requested !== undefined && (!flags.help || validLevel(requested)) ? eventOutput(requested) : current;
}
