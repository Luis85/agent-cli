import type { Command, Registry } from '../../application/plugins/registry.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { arity, value } from '../cli/arguments.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { makeDocument } from '../workspace/commands.ts';
import { libraryGenerationOptions } from './controls.ts';
import { makeUi, uiGenerationOptions } from '../ui/commands.ts';
import { makeDataSource, dataSourceGenerationOptions } from '../data-sources/commands.ts';

export const generatorCatalog = (registry: Registry) => [...registry.generators.values()].map(({ id, description }) => ({ id, description })).concat([
  { id: 'document', description: 'Render an Obsidian Markdown/frontmatter template with typed values.' },
  { id: 'ui', description: 'Generate deterministic UI code from Markdown component definitions.' },
  { id: 'stories', description: 'Generate native Storybook CSF stories for existing UI components.' },
  { id: 'data-source', description: 'Generate a typed REST or local-JSON adapter and deterministic test data from Markdown.' },
]);

export function generationCommand(registry: Registry, services: WorkflowServices): Command {
  return {
    id: 'make',
    description: 'Generate code, planning documents, UI, Storybook stories, or data-source adapters and test data.',
    usage: 'make [generator Name] [--out directory] | make document Title --template name.md [--values JSON | --values-from path] [--date ISO] | make ui|stories <component-id> [--framework html|htmx|vanilla|vue|svelte|react|angular] [--project id] [--library directory] [--out directory] [--stories] [--stories-out directory] [--interactions-library directory] [--revisions-from path.json | --plan | --plan-out path.json | --check] | make data-source <id> [--library directory] [--project id] [--out directory] [--test-data-out directory] [--revisions-from path.json | --plan | --plan-out path.json | --check]',
    options: { out: 'string', template: 'string', values: 'string', 'values-from': 'string', date: 'string', ...libraryGenerationOptions, ...uiGenerationOptions, ...dataSourceGenerationOptions },
    async run(args, flags, context) {
      if (args.length === 0) {
        ensure(['out', 'template', 'values', 'values-from', 'date', ...Object.keys(libraryGenerationOptions), ...Object.keys(uiGenerationOptions), ...Object.keys(dataSourceGenerationOptions)].every(key => flags[key] === undefined), 'INVALID_ARGUMENT', 'Generation options require a generator and name. Run make <generator> <Name>, or make document <Title> --template <name.md>.');
        return { generators: generatorCatalog(registry) };
      }
      arity(args, 2);
      if (args[0] === 'data-source') {
        ensure(['template', 'values', 'values-from', 'date', ...Object.keys(uiGenerationOptions)].every(key => flags[key] === undefined), 'INVALID_ARGUMENT', 'Data-source generation accepts library/project/output/test-data/plan/revision options.');
        return makeDataSource(args[1]!, flags, context, services);
      }
      ensure(flags['test-data-out'] === undefined, 'INVALID_ARGUMENT', '--test-data-out requires make data-source.');
      if (args[0] === 'ui' || args[0] === 'stories') {
        ensure(['template', 'values', 'values-from', 'date'].every(key => flags[key] === undefined), 'INVALID_ARGUMENT', 'Template options require make document.');
        return makeUi(args[0], args[1]!, flags, context, services);
      }
      ensure([...Object.keys(libraryGenerationOptions), ...Object.keys(uiGenerationOptions)].every(key => flags[key] === undefined), 'INVALID_ARGUMENT', 'Library generation options require make ui, make stories, or make data-source.');
      if (args[0] === 'document') return makeDocument(args[1]!, flags, context, services);
      ensure(['template', 'values', 'values-from', 'date'].every(key => flags[key] === undefined), 'INVALID_ARGUMENT', 'Template options require make document.');
      const generator = registry.generators.get(args[0]!); ensure(generator, 'UNKNOWN_GENERATOR', args[0]!);
      ensure(generator.id !== 'plugin' || flags.out === undefined, 'INVALID_ARGUMENT', 'Plugins are generated in the fixed bin/plugins directory; --out is not supported.');
      if (generator.id === 'form') {
        ensure(context.project, 'PROJECT_REQUIRED', 'Open a Forge project with project open <name> before making a form.');
        await context.workspace.files.read('src/presentation/forms/form-model.ts');
      }
      const directory = generator.id === 'plugin' ? 'bin/plugins' : value(flags, 'out') ?? (generator.id === 'form' ? 'src/presentation/forms' : 'src/domain');
      const writes = await generator.generate(args[1]!, directory);
      const result = await context.workspace.write(writes);
      return { generator: generator.id, ...result, ...(context.workspace.dryRun ? { preview: writes.map(w => ({ path: w.path, content: Buffer.from(w.bytes).toString('utf8') })) } : {}) };
    },
  };
}
