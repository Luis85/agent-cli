import { ensure } from '../domain/errors.ts';
import { arity, globalOptions } from './arguments.ts';

type RuntimeSection = 'plugins' | 'marketplaces' | 'runtime';
type Flags = Record<string, string | boolean>;
type OptionKind = 'boolean' | 'string' | 'list' | 'repeat' | 'hash' | 'integer' | 'number' | 'optional-string';
type RuntimeOutput = 'text' | 'json' | 'json-last-line';
interface RuntimeCommand {
  min: number;
  max?: number;
  scope?: boolean;
  managed?: boolean;
  output?: RuntimeOutput;
  options?: Record<string, OptionKind>;
}

const acceptance = { yes: 'boolean', 'accept-command': 'hash' } as const;
const commands: Record<RuntimeSection, Record<string, RuntimeCommand>> = {
  plugins: {
    list: { min: 0, output: 'json', options: { available: 'boolean', 'data-size': 'optional-string' } },
    details: { min: 1 },
    install: { min: 1, scope: true, output: 'json-last-line', options: { ...acceptance, config: 'repeat' } },
    update: { min: 1, scope: true, managed: true, output: 'json-last-line', options: acceptance },
    uninstall: { min: 1, scope: true, output: 'json-last-line', options: { 'keep-data': 'boolean', prune: 'boolean', yes: 'boolean' } },
    enable: { min: 1, scope: true, output: 'json-last-line' },
    disable: { min: 0, max: 1, scope: true, output: 'json-last-line', options: { all: 'boolean' } },
    validate: { min: 1, output: 'json', options: { strict: 'boolean' } },
    configure: { min: 1, output: 'json', options: { 'values-stdin': 'boolean' } },
    prune: { min: 0, scope: true, options: { yes: 'boolean' } },
    init: { min: 1, options: { description: 'string', author: 'string', 'author-email': 'string', with: 'list', force: 'boolean' } },
    tag: { min: 0, max: 1, options: { push: 'boolean', force: 'boolean', message: 'string', remote: 'string' } },
    test: { min: 0, max: 1 },
    eval: { min: 0, max: 1, options: {
      runs: 'integer', concurrency: 'integer', model: 'string', 'judge-model': 'string', ablation: 'string',
      threshold: 'number', 'max-cost-usd': 'number', 'allow-tools': 'list', scaffold: 'boolean', 'no-scaffold': 'boolean',
      'trust-plugin': 'boolean', mocks: 'string', 'eval-dir': 'string', case: 'string', tag: 'list',
      'output-dir': 'string', 'allow-real-servers': 'boolean', 'keep-temp': 'boolean', verbose: 'boolean',
      'no-publish': 'boolean', 'publish-report': 'boolean',
      'native-json': 'boolean', 'native-json-output': 'string',
    } },
    'eval init': { min: 1, options: { bare: 'boolean', interactive: 'boolean', 'eval-dir': 'string' } },
  },
  marketplaces: {
    add: { min: 1, scope: true, options: { sparse: 'list', claudeai: 'boolean' } },
    list: { min: 0, output: 'json' },
    remove: { min: 1, scope: true },
    update: { min: 0, max: 1 },
  },
  runtime: {
    version: { min: 0 },
    doctor: { min: 0 },
    install: { min: 0, max: 1 },
    update: { min: 0 },
  },
};

/** Forge accepts variadic native flags as one string or one JSON array argument. */
export const claudeRuntimeOptions: Record<string, 'string' | 'boolean'> = Object.fromEntries(
  Object.values(commands).flatMap(section => Object.values(section).flatMap(command =>
    Object.entries(command.options ?? {}).map(([name, kind]) => [name, kind === 'boolean' ? 'boolean' : 'string']))),
);

function actionArgs(section: RuntimeSection, args: string[]): { action: string; operands: string[] } {
  const nested = section === 'plugins' && args[0] === 'eval' && args[1] === 'init';
  return { action: nested ? 'eval init' : args[0] ?? '', operands: args.slice(nested ? 2 : 1) };
}

function commandDefinition(section: RuntimeSection, action: string): RuntimeCommand {
  ensure(Object.hasOwn(commands, section) && Object.hasOwn(commands[section], action), 'INVALID_CLAUDE_COMMAND',
    `Unknown Claude ${section} command: ${action || '(missing)'}. See help claude.`);
  return commands[section][action]!;
}

/** Native stdout protocol; a requested eval JSON file is not stdout JSON. */
export function claudeRuntimeOutput(section: RuntimeSection, args: string[], flags: Flags): RuntimeOutput {
  const { action } = actionArgs(section, args);
  const command = commandDefinition(section, action);
  if (section === 'plugins' && action === 'uninstall' && flags.prune === true) return 'text';
  if (section === 'plugins' && action === 'eval') return flags['native-json'] === true && flags['native-json-output'] === undefined ? 'json' : 'text';
  return command.output ?? 'text';
}

/** Only plugin option configuration consumes input; input data never becomes process arguments. */
export function claudeRuntimeNeedsInput(section: RuntimeSection, args: string[], flags: Flags): boolean {
  return section === 'plugins' && args[0] === 'configure' && flags['values-stdin'] === true;
}

function stringValue(value: unknown, flag: string): asserts value is string {
  ensure(typeof value === 'string' && value.length > 0 && !value.includes('\0'), 'INVALID_CLAUDE_OPTION', `--${flag} requires a nonempty string without null bytes.`);
}
function listValue(value: unknown, flag: string): string[] {
  stringValue(value, flag);
  let result: unknown = value;
  if (value.trimStart().startsWith('[')) {
    try { result = JSON.parse(value); }
    catch { ensure(false, 'INVALID_CLAUDE_OPTION', `--${flag} must be a string or a JSON array of strings.`); }
  }
  const list = Array.isArray(result) ? result : [result];
  ensure(list.length > 0 && list.every(item => typeof item === 'string' && item.trim().length > 0 && !item.startsWith('-') && !item.includes('\0')), 'INVALID_CLAUDE_OPTION', `--${flag} requires nonempty strings that do not start with a dash or contain null bytes.`);
  return list as string[];
}
function optionArgs(flag: string, kind: OptionKind, value: string | boolean): string[] {
  if (kind === 'boolean') {
    ensure(typeof value === 'boolean', 'INVALID_CLAUDE_OPTION', `--${flag} is a boolean option.`);
    return value ? [`--${flag}`] : [];
  }
  if (kind === 'optional-string' && (value === true || value === '')) return [`--${flag}`];
  if (kind === 'list' || kind === 'repeat') {
    const list = listValue(value, flag);
    if (flag === 'with') ensure(list.every(item => ['skills', 'agents', 'hooks', 'mcp', 'lsp', 'output-style', 'channel'].includes(item)), 'INVALID_CLAUDE_OPTION', '--with must name skills, agents, hooks, mcp, lsp, output-style, or channel.');
    if (flag === 'config') ensure(list.every(item => /^[^=\s]+=/.test(item)), 'INVALID_CLAUDE_OPTION', '--config entries must use key=value.');
    return kind === 'repeat' ? list.flatMap(item => [`--${flag}`, item]) : [`--${flag}`, ...list];
  }
  stringValue(value, flag);
  if (kind === 'hash') ensure(/^[a-fA-F0-9]{64}$/.test(value), 'INVALID_CLAUDE_OPTION', '--accept-command requires the displayed command SHA-256 hash.');
  if (kind === 'integer') ensure(/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1, 'INVALID_CLAUDE_OPTION', `--${flag} must be a positive integer.`);
  if (kind === 'number') ensure(value.trim().length > 0 && Number.isFinite(Number(value)) && Number(value) >= 0, 'INVALID_CLAUDE_OPTION', `--${flag} must be a finite nonnegative number.`);
  if (flag === 'concurrency') ensure(Number(value) <= 8, 'INVALID_CLAUDE_OPTION', '--concurrency must be between 1 and 8.');
  if (flag === 'threshold') ensure(Number(value) <= 1, 'INVALID_CLAUDE_OPTION', '--threshold must be between 0 and 1.');
  if (flag === 'ablation') ensure(['none', 'with-without'].includes(value), 'INVALID_CLAUDE_OPTION', '--ablation must be none or with-without.');
  if (flag === 'mocks') ensure(['record', 'off'].includes(value), 'INVALID_CLAUDE_OPTION', '--mocks must be record or off.');
  if (flag === 'native-json-output') ensure(value.endsWith('.json'), 'INVALID_CLAUDE_OPTION', '--native-json-output must name a .json file.');
  // An equals form keeps a dash-leading literal value from becoming another native option.
  return value.startsWith('-') ? [`--${flag}=${value}`] : [`--${flag}`, value];
}

function commandRules(section: RuntimeSection, action: string, operands: string[], flags: Flags): void {
  ensure(!(flags.yes === true && flags['accept-command'] !== undefined), 'INVALID_CLAUDE_OPTION', 'Choose --yes or --accept-command, not both.');
  ensure(!(flags.scaffold === true && flags['no-scaffold'] === true), 'INVALID_CLAUDE_OPTION', 'Choose --scaffold or --no-scaffold.');
  ensure(!(flags['no-publish'] === true && flags['publish-report'] === true), 'INVALID_CLAUDE_OPTION', 'Choose --no-publish or --publish-report.');
  if (section === 'plugins' && action === 'disable') {
    ensure(flags.all === true ? operands.length === 0 && flags.scope === undefined : operands.length === 1, 'INVALID_CLAUDE_ARGUMENT', 'Disable one plugin, or use --all without a plugin name or scope.');
  }
  if (section === 'plugins' && action === 'configure') ensure(/^[^@\s]+@[^@\s]+$/.test(operands[0]!), 'INVALID_CLAUDE_ARGUMENT', 'Plugin configure requires the full name@marketplace identifier from plugin list.');
  if (section === 'plugins' && action === 'eval init') ensure(flags.interactive !== true, 'INVALID_CLAUDE_OPTION', '--interactive requires a terminal. Use --bare with a case name, or invoke claude plugin eval init directly in your terminal.');
  if (section === 'marketplaces' && action === 'add' && flags.claudeai === true) ensure(flags.scope === undefined && flags.sparse === undefined, 'INVALID_CLAUDE_OPTION', '--claudeai cannot be combined with --scope or --sparse.');
}

/** Build an inspectable native invocation without executing a process or changing files. */
export function buildClaudeRuntimeArgs(section: RuntimeSection, args: string[], flags: Flags): string[] {
  const { action, operands } = actionArgs(section, args);
  const command = commandDefinition(section, action);
  arity(operands, command.min, command.max ?? command.min);
  for (const operand of operands) {
    ensure(operand.trim().length > 0 && !operand.startsWith('-') && !operand.includes('\0'), 'INVALID_CLAUDE_ARGUMENT',
      'Claude command operands must be nonempty and cannot start with a dash or contain null bytes. Prefix a dash-leading local path with ./ .');
  }
  const options: string[] = [], input = claudeRuntimeNeedsInput(section, args, flags);
  for (const [flag, value] of Object.entries(flags)) {
    if (Object.hasOwn(globalOptions, flag) || flag === 'claude-bin' || flag === 'timeout') continue;
    if (input && ['content', 'from', 'stdin'].includes(flag)) continue;
    if (flag === 'scope' && command.scope) {
      ensure(typeof value === 'string' && ['user', 'project', 'local', ...(command.managed ? ['managed'] : [])].includes(value),
        'INVALID_CLAUDE_SCOPE', `Invalid scope for Claude ${section} ${action}: ${String(value)}.`);
      continue;
    }
    const kind = command.options && Object.hasOwn(command.options, flag) ? command.options[flag] : undefined;
    ensure(kind, 'INVALID_CLAUDE_OPTION', `--${flag} is not supported by Claude ${section} ${action}.`);
    const translated = optionArgs(flag, kind, value);
    if (!['native-json', 'native-json-output'].includes(flag)) options.push(...translated);
  }
  commandRules(section, action, operands, flags);
  if (section === 'runtime') return [action === 'version' ? '--version' : action, ...operands];
  const native = section === 'plugins' ? ['plugin', ...action.split(' '), ...operands] : ['plugin', 'marketplace', action, ...operands];
  const unscoped = (section === 'plugins' && action === 'disable' && flags.all === true) || (section === 'marketplaces' && action === 'add' && flags.claudeai === true);
  if (command.scope && !unscoped) native.push('--scope', typeof flags.scope === 'string' ? flags.scope : 'project');
  const outputPath = flags['native-json-output'];
  if (typeof outputPath === 'string') native.push(...(outputPath.startsWith('-') ? [`--json=${outputPath}`] : ['--json', outputPath]));
  else if (claudeRuntimeOutput(section, args, flags) !== 'text') native.push('--json');
  native.push(...options);
  return native;
}
