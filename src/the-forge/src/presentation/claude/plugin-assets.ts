import { ClaudePluginService } from '../../application/claude/plugins.ts';
import type { CommandContext } from '../../application/plugins/registry.ts';
import type { ClaudeServices } from './services.ts';
import { arity, value } from '../../application/plugins/command-input.ts';
import { parseJson } from '../cli/input.ts';
import { claudeBytes, claudeInput, claudeInputOptions, claudeOptions } from './input.ts';

type Flags = Record<string, string | boolean>;
export const nativePluginActions = ['create', 'inspect', 'manifest', 'check', 'asset', 'write-asset', 'remove-asset'];

export async function nativePlugin(args: string[], flags: Flags, context: CommandContext, services: ClaudeServices) {
  const [action, directory, path] = args;
  claudeOptions(flags, [...(['create', 'manifest', 'write-asset'].includes(action!) ? claudeInputOptions : []), ...(['manifest', 'write-asset', 'remove-asset'].includes(action!) ? ['if-match'] : [])]);
  arity(args, ['asset', 'write-asset', 'remove-asset'].includes(action!) ? 3 : 2);
  const plugins = new ClaudePluginService(context.workspace, services.agentCodec);
  if (action === 'create') return plugins.create(directory!, parseJson(await claudeInput(flags, context)));
  if (action === 'manifest') return plugins.update(directory!, parseJson(await claudeInput(flags, context)), value(flags, 'if-match', true)!);
  if (action === 'inspect') return plugins.inspect(directory!);
  if (action === 'check') return plugins.validate(directory!);
  if (action === 'asset') return plugins.asset(directory!, path!);
  if (action === 'remove-asset') return plugins.removeAsset(directory!, path!, value(flags, 'if-match', true)!);
  return plugins.writeAsset(directory!, path!, await claudeBytes(flags, context), value(flags, 'if-match'));
}
