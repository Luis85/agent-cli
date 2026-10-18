import { ensure } from '../../../domain/shared/errors.ts';
import type { Command, Generator, PluginContext } from '../../../application/plugins/registry.ts';
import { generationControls, generationOutputPath, libraryGenerationOptions } from '../../../application/generation/controls.ts';
import { value } from '../../../application/plugins/command-input.ts';
import { option, type CommandFlags } from '../../../application/plugins/command-metadata.ts';
import { libraryMetadata, libraryOptions, localizedLibraryResult } from '../../../application/plugins/library-commands.ts';
import type { DataSourceLibrary } from '../application/library.ts';
import type { DataSourceSettings } from '../application/settings.ts';

/** What the data-sources plugin's command and generator work with in one invocation, wired by `plugin.ts`. */
export interface DataSourceServices { settings: DataSourceSettings; library: DataSourceLibrary }
export type DataSourceServicesFactory = (context: PluginContext) => DataSourceServices;

async function makeDataSource(id: string, flags: CommandFlags, context: PluginContext, services: DataSourceServicesFactory) {
  const data = services(context), settings = data.settings;
  const scoped = (path: string) => generationOutputPath(path, context.project);
  const directory = value(flags, 'library') ?? settings.library;
  const { mode, manifestPath, revisions } = await generationControls(flags, context.workspace.files);
  const options = {
    source: id, outputDirectory: scoped(value(flags, 'out') ?? settings.output),
    testDataDirectory: scoped(value(flags, 'test-data-out') ?? settings.fixtures),
    ...(revisions ? { revisions } : {}),
  };
  if (mode !== 'generate') {
    const result = mode === 'check' ? await data.library.check(directory, options) : await data.library.plan(directory, options, manifestPath === undefined ? undefined : scoped(manifestPath));
    return { generator: 'data-source', library: directory, ...(mode === 'check' ? { check: true } : { plan: true }), ...result };
  }
  return { generator: 'data-source', library: directory, ...await data.library.generate(directory, options) };
}

/** `make data-source` renders one workspace definition into adapters and test data of the output project. */
export function dataSourceGenerator(services: DataSourceServicesFactory): Generator<PluginContext> {
  return {
    id: 'data-source', description: 'Generate a typed REST or local-JSON adapter and deterministic test data from Markdown.', usage: 'make data-source <id> [--project id] [--out directory] [--test-data-out directory]',
    projectOption: 'project', review: true, idempotent: true,
    errors: ['INVALID_DATA_SOURCE', 'DUPLICATE_DATA_SOURCE', 'UNKNOWN_DATA_SOURCE', 'EMPTY_DATA_SOURCE_LIBRARY', 'DATA_SOURCE_RENDERER_UNAVAILABLE', 'DATA_SOURCE_DRIFT', 'INVALID_GENERATION_PLAN', 'PROJECT_REQUIRED'],
    options: { ...libraryGenerationOptions, 'test-data-out': option.string('Test-data output directory; defaults to plugins.settings.data-sources.fixtures.') },
    run: ({ name, flags, context }) => makeDataSource(name, flags, context, services),
  };
}

/** Definition files are shared at workspace scope; adapters and fixtures follow the selected project. */
export function dataSourcesCommand(services: DataSourceServicesFactory): Command<PluginContext> {
  return {
    id: 'data-sources', description: 'Manage Markdown REST/local-JSON definitions for typed adapters and deterministic test data.',
    usage: 'data-sources [list | init | inspect <id> | validate | create <id> [--kind rest|json] | import [--from directory] | export [--out directory]] [--library directory]',
    ...libraryMetadata('data-sources', 'data-source', { kind: option.string('Data-source kind for create.', { enum: ['rest', 'json'], default: 'rest' }) }),
    options: libraryOptions,
    errors: ['INVALID_DATA_SOURCE', 'DUPLICATE_DATA_SOURCE', 'UNKNOWN_DATA_SOURCE', 'EMPTY_DATA_SOURCE_LIBRARY', 'CONFLICT'],
    async run(args, flags, context) {
      const { settings, library } = services(context);
      const action = args[0] ?? 'list', directory = value(flags, 'library') ?? settings.library;
      if (action === 'list') {
        const definitions = await library.list(directory);
        return localizedLibraryResult('data-sources', context, { directory, count: definitions.length, status: definitions.length ? 'ready' : 'empty',
          ...(!definitions.length ? { nextStep: `Run data-sources init --library ${directory}, or add a Markdown data-source definition.` } : {}),
          sources: definitions.map(definition => ({ id: definition.id, kind: definition.kind, model: definition.model.name, sourcePath: definition.sourcePath, fields: Object.keys(definition.model.fields).sort() })) });
      }
      if (action === 'init') return { directory, ...await library.init(directory) };
      if (action === 'inspect') return library.inspect(directory, args[1]!);
      if (action === 'validate') return localizedLibraryResult('data-sources', context, await library.validate(directory));
      if (action === 'create') {
        const kind = value(flags, 'kind') ?? 'rest';
        ensure(kind === 'rest' || kind === 'json', 'INVALID_ARGUMENT', '--kind must be rest or json.');
        return library.create(directory, args[1]!, kind);
      }
      if (action === 'import') return library.import(value(flags, 'from') ?? settings.imports, directory);
      ensure(action === 'export', 'INVALID_ARGUMENT', 'Use data-sources list, init, inspect, validate, create, import, or export.');
      return library.export(directory, value(flags, 'out') ?? settings.exports);
    },
  };
}
