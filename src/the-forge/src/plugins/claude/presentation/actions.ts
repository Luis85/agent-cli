import { option, type CommandAction, type CommandOption } from '../../../application/plugins/command-metadata.ts';
import { claudeRuntimeActions } from './runtime-commands.ts';

/** `--scope` of one section: each section declares the Claude configuration scopes it supports; default project. */
const scope = (description: string, scopes: readonly string[]) => option.string(`Claude configuration scope (default project). ${description}`, { enum: scopes });
const read = { mutating: false };
/** Agent files, settings and plugin files need --if-match once they exist, so a repeated write fails with CONFLICT. */
const guarded = { idempotent: true };
const ifMatch = option.string('SHA-256 revision the native file must still have.');
const input: Readonly<Record<string, CommandOption>> = {
  from: option.string('Read native input from a file.'),
  content: option.string('Native input as literal text.'),
  stdin: option.boolean('Read native input from piped standard input.'),
};
const target = (scopes: CommandOption): Record<string, CommandOption> => ({
  scope: scopes,
  directory: option.string('Plugin directory for plugin-scoped agents and hooks.'),
  'claude-dir': option.string('Claude user configuration directory for user scope.'),
});
const agentTarget = target(scope('Agent files of the project, the user or a plugin.', ['project', 'user', 'plugin']));
const hookTarget = target(scope('Hook settings of the project, local settings, the user or a plugin.', ['project', 'local', 'user', 'plugin']));
const agentInput = { ...input, metadata: option.string('JSON metadata for agent create or update.'), prompt: option.string('Agent system prompt for create or update.') };
const targetUsage = '[--scope project|user|plugin] [--directory plugin] [--claude-dir directory]';
const hookUsage = '[--scope project|local|user|plugin] [--directory plugin] [--claude-dir directory]';
const inputUsage = '--from file | --content text | --stdin';

const agents: Record<string, CommandAction> = {
  agents: { description: 'List native agents, as agents list does.', usage: `claude agents ${targetUsage}`, ...read, options: agentTarget },
  'agents list': { description: 'List native agents.', usage: `claude agents list ${targetUsage}`, ...read, options: agentTarget },
  'agents inspect': { description: 'Return one native agent with its metadata and prompt.', usage: `claude agents inspect <id> ${targetUsage}`, ...read, options: agentTarget },
  'agents create': { description: 'Create a native agent file.', usage: `claude agents create <id> (${inputUsage} | --metadata json --prompt text) ${targetUsage}`, ...guarded, options: { ...agentTarget, ...agentInput } },
  'agents update': { description: 'Replace a native agent file.', usage: `claude agents update <id> (${inputUsage} | --metadata json --prompt text) --if-match sha256 ${targetUsage}`, ...guarded, options: { ...agentTarget, ...agentInput, 'if-match': ifMatch } },
  'agents remove': { description: 'Remove a native agent file.', usage: `claude agents remove <id> --if-match sha256 ${targetUsage}`, ...guarded, options: { ...agentTarget, 'if-match': ifMatch } },
  'agents enable': { description: 'Enable a native agent in the settings.', usage: `claude agents enable <id> [--if-match sha256] ${targetUsage}`, ...guarded, options: { ...agentTarget, 'if-match': ifMatch } },
  'agents disable': { description: 'Disable a native agent in the settings.', usage: `claude agents disable <id> [--if-match sha256] ${targetUsage}`, ...guarded, options: { ...agentTarget, 'if-match': ifMatch } },
  'agents export': {
    description: 'Return a native agent as Markdown and session JSON, or write it to a .md file with --out.', usage: `claude agents export <id> [--out agent.md [--if-match sha256]] ${targetUsage}`, ...guarded,
    options: { ...agentTarget, out: option.string('Destination path for export.'), 'if-match': ifMatch },
  },
};

const hooks: Record<string, CommandAction> = {
  hooks: { description: 'Inspect the native hook configuration, as hooks inspect does.', usage: `claude hooks ${hookUsage}`, ...read, options: hookTarget },
  'hooks inspect': { description: 'Inspect the native hook configuration.', usage: `claude hooks inspect ${hookUsage}`, ...read, options: hookTarget },
  'hooks check': { description: 'Validate the native hook configuration.', usage: `claude hooks check ${hookUsage}`, ...read, options: hookTarget },
  'hooks set': { description: 'Replace the hook configuration with JSON input.', usage: `claude hooks set (${inputUsage}) [--if-match sha256] ${hookUsage}`, ...guarded, options: { ...hookTarget, ...input, 'if-match': ifMatch } },
  'hooks add': { description: 'Add a hook entry for one event from JSON input.', usage: `claude hooks add <event> (${inputUsage}) [--if-match sha256] ${hookUsage}`, ...guarded, options: { ...hookTarget, ...input, 'if-match': ifMatch } },
  'hooks remove': {
    description: 'Remove the hooks of one event, or one entry with --index.', usage: `claude hooks remove <event> --if-match sha256 [--index n] ${hookUsage}`, ...guarded,
    options: { ...hookTarget, 'if-match': ifMatch, index: option.string('Hook entry index for hooks remove.') },
  },
  'hooks configure': { description: 'Set hook-related settings from JSON input.', usage: `claude hooks configure (${inputUsage}) [--if-match sha256] ${hookUsage}`, ...guarded, options: { ...hookTarget, ...input, 'if-match': ifMatch } },
  'hooks enable': { description: 'Enable every hook of the settings file.', usage: `claude hooks enable [--if-match sha256] ${hookUsage}`, ...guarded, options: { ...hookTarget, 'if-match': ifMatch } },
  'hooks disable': { description: 'Disable every hook of the settings file.', usage: `claude hooks disable [--if-match sha256] ${hookUsage}`, ...guarded, options: { ...hookTarget, 'if-match': ifMatch } },
};

/** Claude plugin authoring: files of a plugin directory, written with workspace guards. */
const authoring: Record<string, CommandAction> = {
  'plugins create': { description: 'Create a Claude plugin directory from a JSON manifest.', usage: `claude plugins create <directory> (${inputUsage})`, ...guarded, options: input },
  'plugins inspect': { description: 'Describe a Claude plugin directory and its assets.', usage: 'claude plugins inspect <directory>', ...read },
  'plugins manifest': { description: 'Replace the plugin manifest with JSON input.', usage: `claude plugins manifest <directory> (${inputUsage}) --if-match sha256`, ...guarded, options: { ...input, 'if-match': ifMatch } },
  'plugins check': { description: 'Validate a Claude plugin directory.', usage: 'claude plugins check <directory>', ...read },
  'plugins asset': { description: 'Read one asset of a Claude plugin.', usage: 'claude plugins asset <directory> <path>', ...read },
  'plugins write-asset': { description: 'Write one asset of a Claude plugin.', usage: `claude plugins write-asset <directory> <path> (${inputUsage}) [--if-match sha256]`, ...guarded, options: { ...input, 'if-match': ifMatch } },
  'plugins remove-asset': { description: 'Remove one asset of a Claude plugin.', usage: 'claude plugins remove-asset <directory> <path> --if-match sha256', ...guarded, options: { 'if-match': ifMatch } },
};

/** What each installed-CLI action does; the native CLI documents its own options. */
const runtimeDescriptions: Record<string, string> = {
  'plugins list': 'List installed plugins, or available ones with --available.',
  'plugins details': 'Describe one installed plugin.',
  'plugins install': 'Install a plugin from a marketplace.',
  'plugins update': 'Update an installed plugin.',
  'plugins uninstall': 'Uninstall a plugin.',
  'plugins enable': 'Enable an installed plugin.',
  'plugins disable': 'Disable one plugin, or every plugin with --all.',
  'plugins validate': 'Validate a plugin or marketplace with the installed CLI.',
  'plugins configure': 'Configure the options of an installed plugin; --values-stdin reads the values as JSON input.',
  'plugins prune': 'Remove plugins that nothing requires any more.',
  'plugins init': 'Scaffold a new plugin with the installed CLI.',
  'plugins tag': 'Tag a plugin release.',
  'plugins test': 'Run the tests of a plugin.',
  'plugins eval': 'Run the evaluation cases of a plugin.',
  'plugins eval init': 'Create evaluation cases for a plugin.',
  'marketplaces add': 'Add a plugin marketplace.',
  'marketplaces list': 'List the configured marketplaces.',
  'marketplaces remove': 'Remove a marketplace.',
  'marketplaces update': 'Update one marketplace, or all of them.',
  'runtime version': 'Report the installed Claude Code version.',
  'runtime doctor': 'Diagnose the installed Claude Code CLI.',
  'runtime install': 'Install Claude Code, optionally a version or channel.',
  'runtime update': 'Update the installed Claude Code CLI.',
};
const readRuntime = new Set(['plugins list', 'plugins details', 'plugins validate', 'marketplaces list', 'runtime version', 'runtime doctor']);
const native: Record<string, CommandOption> = {
  'claude-bin': option.string('Path of the Claude Code executable; defaults to claude on PATH.'),
  timeout: option.string('Native process timeout in milliseconds (1 to 3600000).'),
};
const pluginScope = (managed: boolean) => scope('Installed-CLI plugin commands: the native scope; managed only with plugins update.', ['project', 'local', 'user', ...(managed ? ['managed'] : [])]);
const marketplaceScope = scope('Marketplace add and remove: the native scope.', ['project', 'local', 'user']);
const runtime = Object.fromEntries(claudeRuntimeActions.map(({ section, action, scoped, managed, options }): [string, CommandAction] => {
  const id = `${section} ${action}`;
  const scopes: Record<string, CommandOption> = scoped ? { scope: section === 'plugins' ? pluginScope(managed) : marketplaceScope } : {};
  const values = id === 'plugins configure' ? input : {};
  const flags = Object.entries({ ...scopes, ...options, ...values }).map(([name, schema]) => `[--${name}${schema.type === 'string' ? ' value' : ''}]`);
  return [id, {
    description: runtimeDescriptions[id]!, usage: ['claude', id, '[operands]', ...flags, '[--claude-bin path] [--timeout ms]'].join(' '),
    ...(readRuntime.has(id) ? read : {}), options: { ...scopes, ...options, ...values, ...native },
  }];
}));

/** The `claude` sections and their actions, each with exactly the options it accepts. */
export const claudeActions: Readonly<Record<string, CommandAction>> = {
  capabilities: { description: 'Describe supported formats, scopes and operations.', usage: 'claude [capabilities]', scope: 'workspace', discovery: true, mutating: false },
  ...agents, ...hooks, ...authoring, ...runtime,
};
