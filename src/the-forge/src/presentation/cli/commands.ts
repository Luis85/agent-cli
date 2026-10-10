import type { Command, Registry } from '../../application/plugins/registry.ts';
import type { WorkflowServices } from './services.ts';
import { catalogCommands, extensionCommands } from './catalog-commands.ts';
import { workflowCommands } from '../workspace/commands.ts';
import { dataSourceCommands } from '../data-sources/commands.ts';
import { workflowsCommands } from '../workflows/commands.ts';
import { documentCommands } from '../documents/commands.ts';
import { vaultCommands } from '../documents/vault-commands.ts';
import { generationCommand } from '../generation/commands.ts';

/** Kernel commands in catalog order; core and user plugins contribute theirs through the registry. */
export function commands(registry: Registry, services: WorkflowServices): Command[] {
  return [
    ...workflowCommands(services),
    ...dataSourceCommands(services),
    ...workflowsCommands(services),
    ...catalogCommands(registry),
    ...documentCommands(),
    ...vaultCommands(),
    generationCommand(registry),
    ...extensionCommands(registry, services),
  ];
}
