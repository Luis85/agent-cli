import type { Command, Generator, Registry } from '../../application/plugins/registry.ts';
import type { CommandAction, CommandOption } from '../../application/plugins/command-metadata.ts';
import { arity, globalOptions, value } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { GenerationService } from '../../application/generation/plans.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { generationControls, reviewOptions } from '../../application/generation/controls.ts';

export const generatorCatalog = (registry: Registry) => [...registry.generators.values()].map(({ id, description }) => ({ id, description }));
const out = { out: option.string('Output directory; each generator documents its default.') };

/** The flags a generator accepts besides the global options: host-owned --out and review controls plus its own. */
function generatorOptions(generator: Generator): Record<string, CommandOption> {
  return { ...(generator.fixedDirectory ? {} : out), ...generator.options, ...(generator.review ? reviewOptions : {}) };
}

/**
 * `make` routes to registered generators by id: kernel, core plugin and user plugin generators alike. Each
 * generator is one action with its own mode and options, so the parser accepts a generator's options only after
 * `make <generator>` and one generator's option types never affect another's.
 */
export function generationCommand(registry: Registry): Command {
  return {
    id: 'make',
    description: 'Run a registered generator, or list the generators.',
    usage: 'make [generator Name] [--out directory]',
    scope: 'workspace', discovery: false, mutating: false,
    args: [
      { name: 'generator', description: 'A generator id; without one, make lists the generators.' },
      { name: 'name', description: 'The name or id the generator creates from.' },
    ],
    unknownAction: 'UNKNOWN_GENERATOR',
    errors: ['UNKNOWN_GENERATOR', 'INVALID_NAME', 'CONFLICT', 'GENERATION_DRIFT', 'INVALID_GENERATION_PLAN', 'INVALID_GENERATION_REVISIONS', 'PROJECT_REQUIRED'],
    get actions() {
      return Object.fromEntries([...registry.generators.values()].map((generator): [string, CommandAction] => [generator.id, {
        description: generator.description, usage: generator.usage ?? `make ${generator.id} <Name>`,
        scope: generator.scope ?? 'project', discovery: false, mutating: generator.mutating ?? true,
        ...(generator.projectOption ? { projectOption: generator.projectOption } : {}),
        options: generatorOptions(generator),
      }]));
    },
    async run(args, flags, context) {
      const own = Object.keys(flags).filter(key => !Object.hasOwn(globalOptions, key));
      if (args.length === 0) {
        ensure(own.length === 0, 'INVALID_ARGUMENT', 'Generation options require a generator and name. Run make <generator> <Name>; help make lists each generator\'s usage and options.');
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
