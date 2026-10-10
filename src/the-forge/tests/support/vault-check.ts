import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { Registry, type CommandContext } from '../../src/application/plugins/registry.ts';
import { registerCorePlugins, registrySkills, type CorePlugin } from '../../src/application/plugins/core-plugins.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { basesPlugin } from '../../src/plugins/bases/plugin.ts';
import { vaultCheckPlugin } from '../../src/plugins/vault-check/plugin.ts';
import { testHost } from './core-plugins.ts';
import { scopeServices } from './metadata.ts';

export interface VaultFinding { rule: string; severity: string; path: string; line: number | null; column: number | null; message: string; hint: string; suggestion?: string }
interface VaultCheckResult {
  findings: VaultFinding[]; summary: Record<string, number>; strict: boolean;
  rules: Array<{ id: string; severity: string; findings: number }>; skipped: Array<{ rule: string; reason: string; message: string }>;
}

/**
 * The `vault` command of the vault-check core plugin over the files below `root`, registered like the composition
 * root does: after `bases` unless `plugins` says otherwise, with `settings` as `plugins.settings`.
 */
export async function vaultCommand(root: string, settings: Record<string, unknown> = {}, options: { plugins?: CorePlugin[]; language?: 'en' | 'de' } = {}) {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  registerCorePlugins(registry, events, options.plugins ?? [basesPlugin, vaultCheckPlugin], testHost({ skills: registrySkills(registry) }), []);
  await registry.configure(settings, async () => [], message => events.warn(message));
  const workspace = new Workspace(await NodeFiles.at(root), new ObsidianDocuments(), events, false);
  const context = { workspace, events, root, workspaceRoot: root, project: null, input: async () => new Uint8Array(), ...scopeServices(workspace, events), language: options.language ?? 'en' } as unknown as CommandContext;
  const run = (args: string[], flags: Record<string, string | boolean> = {}) => registry.commands.get('vault')!.run(args, flags, context);
  return { run, check: (flags: Record<string, string | boolean> = {}) => run(['check'], flags) as Promise<VaultCheckResult>, events };
}
