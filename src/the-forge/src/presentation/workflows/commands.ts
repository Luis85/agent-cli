import { ensure } from '../../domain/shared/errors.ts';
import type { Command } from '../../application/plugins/registry.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { arity } from '../cli/arguments.ts';

/** Project-owned CI: authored per project, synchronized into the workspace's GitHub workflow directory. */
export function workflowsCommands(services: WorkflowServices): Command[] {
  return [{
    id: 'workflows', description: 'Discover project-owned CI workflows and synchronize their generated GitHub entrypoints; --check reports drift.',
    usage: 'workflows [list | sync [--check] [--dry-run]]',
    options: { check: 'boolean' },
    async run(args, flags) {
      const action = args[0] ?? 'list';
      ensure(flags.check === undefined || action === 'sync', 'INVALID_ARGUMENT', '--check requires workflows sync.');
      if (action === 'list') { arity(args, 0, 1); return services.workflows.list(); }
      ensure(action === 'sync', 'INVALID_ARGUMENT', 'Use workflows list or workflows sync [--check].');
      arity(args, 1);
      return flags.check === true ? services.workflows.check() : services.workflows.sync();
    },
  }];
}
