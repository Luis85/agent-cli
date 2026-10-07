import { value, type ParsedArguments } from './arguments.ts';

export interface InvocationPolicy {
  scope: 'workspace' | 'project';
  activatePlugins: boolean;
  requestedProject?: string;
}

/** Arguments exclude the command id. Keep recovery independent of saved projects. */
export function invocationPolicy(id: string, args: readonly string[], flags: ParsedArguments['flags']): InvocationPolicy {
  const discovery = ['help', 'schema', 'config', 'formats', 'events', 'plugins', 'setup'].includes(id);
  const claudeCapabilities = id === 'claude' && (args.length === 0 || args[0] === 'capabilities');
  const workspace = flags.help === true || discovery || claudeCapabilities
    || ['project', 'templates', 'components', 'data-sources', 'interactions'].includes(id)
    || (id === 'make' && (args.length === 0 || args[0] === 'plugin'))
    || (id === 'skills' && args[0] !== 'install');
  const requestedProject = id === 'make' && ['ui', 'stories', 'data-source'].includes(args[0] ?? '') ? value(flags, 'project') : undefined;
  return {
    scope: workspace ? 'workspace' : 'project',
    activatePlugins: flags.help !== true && !discovery && !claudeCapabilities,
    ...(requestedProject === undefined ? {} : { requestedProject }),
  };
}
