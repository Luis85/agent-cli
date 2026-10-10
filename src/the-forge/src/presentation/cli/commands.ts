import type { Command, Registry } from '../../application/plugins/registry.ts';
import type { WorkflowServices } from './services.ts';
import { catalogCommands, extensionCommands } from './catalog-commands.ts';
import { workflowCommands } from '../workspace/commands.ts';
import { uiCommands } from '../ui/commands.ts';
import { dataSourceCommands } from '../data-sources/commands.ts';
import { interactionCommands } from '../interactions/commands.ts';
import { workflowsCommands } from '../workflows/commands.ts';
import { documentCommands } from '../documents/commands.ts';
import { generationCommand } from '../generation/commands.ts';
import { skillsCommand } from '../skills/commands.ts';

export function commands(registry: Registry, services: WorkflowServices): Command[] {
  return [
    ...workflowCommands(services),
    ...uiCommands(services),
    ...dataSourceCommands(services),
    ...interactionCommands(services),
    ...workflowsCommands(services),
    ...catalogCommands(registry),
    ...documentCommands(),
    generationCommand(registry, services),
    ...extensionCommands(registry),
    skillsCommand(registry),
  ];
}
