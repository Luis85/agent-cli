import { ensure } from '../../domain/shared/errors.ts';
import type { Command } from '../../application/plugins/registry.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { arity } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';

/** Project-owned CI: authored per project, synchronized into the workspace's GitHub workflow directory. */
export function workflowsCommands(services: WorkflowServices): Command[] {
  return [{
    id: 'workflows', description: 'Discover project-owned CI workflows and synchronize their generated GitHub entrypoints; --check reports drift.',
    usage: 'workflows [list | sync [--check] [--dry-run]]',
    scope: 'workspace', discovery: false, mutating: true, defaultAction: 'list', unknownAction: 'INVALID_ARGUMENT',
    actions: {
      list: { description: 'List every managed project\'s authored workflows and their generated entrypoints.', usage: 'workflows [list]', mutating: false },
      sync: {
        description: 'Write the generated .github/workflows entrypoints; with --check, report drift without writing.', usage: 'workflows sync [--check] [--dry-run]', idempotent: true,
        options: { check: option.boolean('With sync: fail with WORKFLOW_DRIFT instead of writing when generated workflows differ.') },
      },
    },
    args: [{ name: 'action', description: 'list (default) or sync.', enum: ['list', 'sync'] }],
    errors: ['INVALID_WORKFLOW', 'WORKFLOW_DRIFT', 'CONFLICT'],
    async run(args, flags) {
      const action = args[0] ?? 'list';
      if (action === 'list') { arity(args, 0, 1); return services.workflows.list(); }
      ensure(action === 'sync', 'INVALID_ARGUMENT', 'Use workflows list or workflows sync [--check].');
      arity(args, 1);
      return flags.check === true ? services.workflows.check() : services.workflows.sync();
    },
  }];
}
