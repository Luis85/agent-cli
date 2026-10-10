import type { Generator } from '../../application/plugins/registry.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { makeDocument } from '../workspace/commands.ts';

/** Kernel generators with their own results: template documents. */
export function libraryGenerators(services: WorkflowServices): Generator[] {
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
  ];
}
