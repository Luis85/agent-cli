import type { Generator } from '../../application/plugins/registry.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { libraryGenerationOptions } from './controls.ts';
import { makeUi, uiGenerationOptions } from '../ui/commands.ts';
import { makeDataSource, dataSourceGenerationOptions } from '../data-sources/commands.ts';

/** Kernel generators with their own results: library-driven UI, stories and adapters. */
export function libraryGenerators(services: WorkflowServices): Generator[] {
  const library = { projectOption: 'project', options: { ...libraryGenerationOptions } } as const;
  return [
    {
      id: 'ui', description: 'Generate deterministic UI code from Markdown component definitions.', usage: 'make ui <component-id> [--framework target] [--stories] [--project id] [--out directory]',
      ...library, options: { ...library.options, ...uiGenerationOptions },
      run: ({ name, flags, context }) => makeUi('ui', name, flags, context, services),
    },
    {
      id: 'stories', description: 'Generate native Storybook CSF stories for existing UI components.', usage: 'make stories <component-id> [--framework target] [--project id] [--stories-out directory]',
      ...library, options: { ...library.options, ...uiGenerationOptions },
      run: ({ name, flags, context }) => makeUi('stories', name, flags, context, services),
    },
    {
      id: 'data-source', description: 'Generate a typed REST or local-JSON adapter and deterministic test data from Markdown.', usage: 'make data-source <id> [--project id] [--out directory] [--test-data-out directory]',
      ...library, options: { ...library.options, ...dataSourceGenerationOptions },
      run: ({ name, flags, context }) => makeDataSource(name, flags, context, services),
    },
  ];
}
