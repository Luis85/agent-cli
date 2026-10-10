import { ensure } from '../../domain/shared/errors.ts';
import type { Command, CommandContext } from '../../application/plugins/registry.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { generationControls, generationOutputPath } from '../generation/controls.ts';
import { arity, value } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { libraryMetadata, libraryOptions } from '../cli/library-metadata.ts';

export const dataSourceGenerationOptions = { 'test-data-out': option.string('Test-data output directory; defaults to paths.dataFixtures.') };

export async function makeDataSource(id: string, flags: Record<string, string | boolean>, context: CommandContext, services: WorkflowServices) {
  const config = services.loaded.config;
  const scoped = (path: string) => generationOutputPath(path, context.project);
  const directory = value(flags, 'library') ?? config.paths.dataSources;
  const { mode, manifestPath, revisions } = await generationControls(flags, context.workspace.files);
  const options = {
    source: id, outputDirectory: scoped(value(flags, 'out') ?? config.paths.dataGenerated),
    testDataDirectory: scoped(value(flags, 'test-data-out') ?? config.paths.dataFixtures),
    ...(revisions ? { revisions } : {}),
  };
  if (mode !== 'generate') {
    const result = mode === 'check' ? await services.dataSources.check(directory, options) : await services.dataSources.plan(directory, options, manifestPath === undefined ? undefined : scoped(manifestPath));
    return { generator: 'data-source', library: directory, ...(mode === 'check' ? { check: true } : { plan: true }), ...result };
  }
  return { generator: 'data-source', library: directory, ...await services.dataSources.generate(directory, options) };
}

/** Definition files are shared at workspace scope; adapters and fixtures follow the selected project. */
export function dataSourceCommands(services: WorkflowServices): Command[] {
  const config = services.loaded.config;
  return [{
    id: 'data-sources', description: 'Manage Markdown REST/local-JSON definitions for typed adapters and deterministic test data.',
    usage: 'data-sources [list | init | inspect <id> | validate | create <id> [--kind rest|json] | import [--from directory] | export [--out directory]] [--library directory]',
    ...libraryMetadata('data-source'),
    options: { ...libraryOptions, kind: option.string('Data-source kind for create.', { enum: ['rest', 'json'], default: 'rest' }) },
    errors: ['INVALID_DATA_SOURCE', 'DUPLICATE_DATA_SOURCE', 'UNKNOWN_DATA_SOURCE', 'CONFLICT'],
    async run(args, flags) {
      const action = args[0] ?? 'list', directory = value(flags, 'library') ?? config.paths.dataSources;
      ensure(flags.from === undefined || action === 'import', 'INVALID_ARGUMENT', '--from requires data-sources import.');
      ensure(flags.out === undefined || action === 'export', 'INVALID_ARGUMENT', '--out requires data-sources export.');
      ensure(flags.kind === undefined || action === 'create', 'INVALID_ARGUMENT', '--kind requires data-sources create.');
      const library = services.dataSources;
      if (action === 'list') {
        arity(args, 0, 1);
        const definitions = await library.list(directory);
        return { directory, count: definitions.length, status: definitions.length ? 'ready' : 'empty',
          ...(!definitions.length ? { nextStep: `Run data-sources init --library ${directory}, or add a Markdown data-source definition.` } : {}),
          sources: definitions.map(definition => ({ id: definition.id, kind: definition.kind, model: definition.model.name, sourcePath: definition.sourcePath, fields: Object.keys(definition.model.fields).sort() })) };
      }
      if (action === 'init') { arity(args, 1); return { directory, ...await library.init(directory) }; }
      if (action === 'inspect') { arity(args, 2); return library.inspect(directory, args[1]!); }
      if (action === 'validate') { arity(args, 1); return library.validate(directory); }
      if (action === 'create') {
        arity(args, 2); const kind = value(flags, 'kind') ?? 'rest';
        ensure(kind === 'rest' || kind === 'json', 'INVALID_ARGUMENT', '--kind must be rest or json.');
        return library.create(directory, args[1]!, kind);
      }
      if (action === 'import') { arity(args, 1); return library.import(value(flags, 'from') ?? config.paths.dataImports, directory); }
      ensure(action === 'export', 'INVALID_ARGUMENT', 'Use data-sources list, init, inspect, validate, create, import, or export.');
      arity(args, 1); return library.export(directory, value(flags, 'out') ?? config.paths.dataExports);
    },
  }];
}
