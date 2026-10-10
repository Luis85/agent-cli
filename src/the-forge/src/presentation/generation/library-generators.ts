import type { Generator } from '../../application/plugins/registry.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { makeDocument } from '../workspace/commands.ts';
import { libraryGenerationOptions } from './controls.ts';
import { makeUi, uiGenerationOptions } from '../ui/commands.ts';
import { makeDataSource, dataSourceGenerationOptions } from '../data-sources/commands.ts';

/** Kernel generators with their own results: template documents and library-driven UI, stories and adapters. */
export function libraryGenerators(services: WorkflowServices): Generator[] {
  const library = { projectOption: 'project', options: { ...libraryGenerationOptions } } as const;
  return [
    {
      id: 'document', description: 'Render an Obsidian Markdown/frontmatter template with typed values.', usage: 'make document Title --template name.md [--values JSON | --values-from path] [--date ISO] [--out notes]',
      directory: 'notes',
      options: {
        template: option.string('Markdown template under bin/templates.', { required: true }),
        values: option.string('Template values as a JSON object.'),
        'values-from': option.string('Read template values from a JSON file.'),
        date: option.string('ISO date used for template dates; defaults to today.'),
      },
      run: ({ name, flags, context }) => makeDocument(name, flags, context, services),
    },
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
