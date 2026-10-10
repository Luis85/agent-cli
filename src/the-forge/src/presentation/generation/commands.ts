import type { Command, Generator, Registry } from '../../application/plugins/registry.ts';
import type { CommandAction, CommandOption } from '../../application/plugins/command-metadata.ts';
import { arity, value } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { GenerationService } from '../../application/generation/plans.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { globalOptions } from '../cli/arguments.ts';
import { generationControls, reviewOptions } from './controls.ts';

export const generatorCatalog = (registry: Registry) => [...registry.generators.values()].map(({ id, description }) => ({ id, description }));
const out = { out: option.string('Output directory; each generator documents its default.') };

/** The flags a generator accepts besides the global options. */
function generatorOptions(generator: Generator): Record<string, CommandOption> {
  return { ...(generator.fixedDirectory ? {} : out), ...generator.options, ...(generator.review ? reviewOptions : {}) };
}

/**
 * `make` routes to registered generators by id: kernel, core plugin and user plugin generators alike. Its options
 * and actions are the union of the generators' declared metadata, so scope and help follow each generator.
 */
export function generationCommand(registry: Registry): Command {
  return {
    id: 'make',
    description: 'Generate code, planning documents, UI, Storybook stories, or data-source adapters and test data.',
    usage: 'make [generator Name] [--out directory] | make document Title --template name.md [--values JSON | --values-from path] [--date ISO] | make ui|stories <component-id> [--framework html|htmx|vanilla|vue|svelte|react|angular] [--project id] [--library directory] [--out directory] [--stories] [--stories-out directory] [--interactions-library directory] [--revisions-from path.json | --plan | --plan-out path.json | --check] | make data-source <id> [--library directory] [--project id] [--out directory] [--test-data-out directory] [--revisions-from path.json | --plan | --plan-out path.json | --check]',
    scope: 'workspace', discovery: false, mutating: false,
    args: [
      { name: 'generator', description: 'A generator id; without one, make lists the generators.' },
      { name: 'name', description: 'The name or id the generator creates from.' },
    ],
    errors: ['UNKNOWN_GENERATOR', 'INVALID_NAME', 'CONFLICT', 'GENERATION_DRIFT', 'INVALID_GENERATION_PLAN', 'INVALID_GENERATION_REVISIONS', 'PROJECT_REQUIRED'],
    get options() {
      return Object.assign({}, ...[...registry.generators.values()].map(generatorOptions)) as Record<string, CommandOption>;
    },
    get actions() {
      return Object.fromEntries([...registry.generators.values()].map((generator): [string, CommandAction] => [generator.id, {
        description: generator.description, scope: generator.scope ?? 'project', discovery: false, mutating: generator.mutating ?? true,
        ...(generator.projectOption ? { projectOption: generator.projectOption } : {}),
      }]));
    },
    async run(args, flags, context) {
      const own = Object.keys(flags).filter(key => !Object.hasOwn(globalOptions, key));
      if (args.length === 0) {
        ensure(own.length === 0, 'INVALID_ARGUMENT', 'Generation options require a generator and name. Run make <generator> <Name>, or make document <Title> --template <name.md>.');
        return { generators: generatorCatalog(registry) };
      }
      arity(args, 2);
      const generator = registry.generators.get(args[0]!); ensure(generator, 'UNKNOWN_GENERATOR', args[0]!);
      const accepted = generatorOptions(generator);
      for (const key of own) ensure(Object.hasOwn(accepted, key), 'INVALID_ARGUMENT', `--${key} is not supported by make ${generator.id}; run help make for each generator's options.`);
      const directory = generator.fixedDirectory ? generator.directory! : value(flags, 'out') ?? generator.directory ?? 'src/domain';
      const generation = new GenerationService(context.workspace);
      const request = { name: args[1]!, directory, flags, context, generation };
      if (generator.run) return generator.run(request);
      const writes = await generator.generate!(request);
      if (generator.review) {
        const { mode, manifestPath, revisions } = await generationControls(flags, context.workspace.files);
        if (mode === 'check') return { generator: generator.id, check: true, ...await generation.check(writes, 'GENERATION_DRIFT') };
        if (mode === 'plan') return { generator: generator.id, plan: true, ...await generation.plan(writes, manifestPath) };
        return { generator: generator.id, ...await generation.commit(writes, revisions) };
      }
      const result = await context.workspace.write(writes);
      return { generator: generator.id, ...result, ...(context.workspace.dryRun ? { preview: writes.map(w => ({ path: w.path, content: new TextDecoder().decode(w.bytes) })) } : {}) };
    },
  };
}
