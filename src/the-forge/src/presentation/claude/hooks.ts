import { ensure } from '../../domain/shared/errors.ts';
import { ClaudeSettings } from '../../application/claude/settings.ts';
import type { CommandContext } from '../../application/plugins/registry.ts';
import type { ClaudeServices } from './services.ts';
import { arity, value } from '../../application/plugins/command-input.ts';
import { parseJson } from '../../application/plugins/command-input.ts';
import { claudeInput, claudeInputOptions, claudeOptions, claudeScopeOptions } from './input.ts';

type Flags = Record<string, string | boolean>;

export async function hookCommands(args: string[], flags: Flags, context: CommandContext, services: ClaudeServices) {
  const action = args[0] ?? 'inspect';
  const mutating = ['set', 'add', 'remove', 'configure', 'enable', 'disable'].includes(action);
  const inputs = ['set', 'add', 'configure'].includes(action) ? claudeInputOptions : [];
  claudeOptions(flags, [...claudeScopeOptions, ...inputs, ...(mutating ? ['if-match'] : []), ...(action === 'remove' ? ['index'] : [])]);
  const target = await services.target(context, flags);
  const settings = new ClaudeSettings(target.workspace, target.settingsPath, target.scope === 'plugin');
  const revision = value(flags, 'if-match');
  let result: object;
  switch (action) {
    case 'inspect':
    case 'check':
      arity(args, 0, 1);
      result = action === 'inspect' ? await settings.inspect() : await settings.validate();
      break;
    case 'set':
    case 'configure': {
      arity(args, 1);
      const input = parseJson(await claudeInput(flags, context));
      result = action === 'set' ? await settings.set(input, revision) : await settings.configure(input, revision);
      break;
    }
    case 'add':
      arity(args, 2);
      result = await settings.add(args[1]!, parseJson(await claudeInput(flags, context)), revision);
      break;
    case 'remove': {
      arity(args, 2);
      const index = value(flags, 'index');
      result = await settings.remove(args[1]!, value(flags, 'if-match', true)!, index === undefined ? undefined : Number(index));
      break;
    }
    default:
      ensure(action === 'enable' || action === 'disable', 'INVALID_ARGUMENT', 'Use hooks inspect, check, set, add, remove, configure, enable, or disable.');
      arity(args, 1);
      result = await settings.toggle(action === 'enable', revision);
  }
  return { target: { scope: target.scope, directory: target.directory }, ...result };
}
